/**
 * Mock Convex React Provider — drop-in replacement for ConvexProvider + hooks.
 *
 * Uses HTTP polling against the mock Convex backend instead of WebSocket sync.
 * Provides useQuery (with auto-refresh), useMutation, and useAction hooks
 * that are API-compatible with the real convex/react hooks.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { getFunctionName } from "convex/server";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
interface MockConvexContextValue {
  url: string;
  version: number;
}

const MockConvexContext = createContext<MockConvexContextValue | null>(null);
const BumpContext = createContext<() => void>(() => {});

function useMockConvex(): MockConvexContextValue {
  const ctx = useContext(MockConvexContext);
  if (!ctx)
    throw new Error("useMockConvex: wrap your app in <MockConvexProvider>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function MockConvexProvider({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(() => ({ url, version }), [url, version]);

  // Auto-refresh every 3s to pick up diode/external changes
  useEffect(() => {
    const id = setInterval(bump, 3000);
    return () => clearInterval(id);
  }, [bump]);

  return (
    <MockConvexContext.Provider value={value}>
      <BumpContext.Provider value={bump}>{children}</BumpContext.Provider>
    </MockConvexContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resolvePath(ref: unknown): string {
  if (typeof ref === "string") return ref;
  try {
    return getFunctionName(ref as any);
  } catch {
    return String(ref);
  }
}

interface ApiResponse {
  status: string;
  value?: unknown;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// useQuery
// ---------------------------------------------------------------------------
export function useQuery(ref: any, args?: Record<string, unknown> | "skip"): any {
  const { url, version } = useMockConvex();
  const [data, setData] = useState<unknown>(undefined);
  const path = resolvePath(ref);
  const skip = args === "skip";
  const argsJson = skip ? "skip" : JSON.stringify(args ?? {});

  useEffect(() => {
    if (skip) {
      setData(undefined);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${url}/api/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, args: JSON.parse(argsJson) }),
        });
        if (!res.ok) return;
        const json: ApiResponse = await res.json();
        if (!cancelled && json.status === "success") {
          setData(json.value);
        }
      } catch {
        // Retry on next cycle
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, path, argsJson, version, skip]);

  return data;
}

// ---------------------------------------------------------------------------
// useMutation
// ---------------------------------------------------------------------------
export function useMutation(
  ref: any,
): (args: Record<string, unknown>) => Promise<any> {
  const { url } = useMockConvex();
  const bump = useContext(BumpContext);
  const path = resolvePath(ref);

  return useCallback(
    async (args: Record<string, unknown>) => {
      const res = await fetch(`${url}/api/mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, args }),
      });
      const json: ApiResponse = await res.json();
      if (json.status === "error") {
        throw new Error(json.errorMessage ?? "Mutation failed");
      }
      bump();
      return json.value;
    },
    [url, path, bump],
  );
}

// ---------------------------------------------------------------------------
// useAction
// ---------------------------------------------------------------------------
export function useAction(
  ref: any,
): (args: Record<string, unknown>) => Promise<any> {
  const { url } = useMockConvex();
  const bump = useContext(BumpContext);
  const path = resolvePath(ref);

  return useCallback(
    async (args: Record<string, unknown>) => {
      const res = await fetch(`${url}/api/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, args }),
      });
      const json: ApiResponse = await res.json();
      if (json.status === "error") {
        throw new Error(json.errorMessage ?? "Action failed");
      }
      bump();
      return json.value;
    },
    [url, path, bump],
  );
}
