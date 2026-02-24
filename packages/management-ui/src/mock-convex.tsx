/**
 * Dual-Backend Mock Convex Provider for Management Dashboard.
 *
 * Unlike the other apps that connect to a single backend (unclass OR restricted),
 * the management dashboard needs visibility across BOTH sides of the air gap.
 * Provides useQueryUnclass, useQueryRestricted, and combined useQueryBoth hooks.
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
interface DualConvexContextValue {
  unclassUrl: string;
  restrictedUrl: string;
  version: number;
}

const DualConvexContext = createContext<DualConvexContextValue | null>(null);
const BumpContext = createContext<() => void>(() => {});

function useDualConvex(): DualConvexContextValue {
  const ctx = useContext(DualConvexContext);
  if (!ctx)
    throw new Error("useDualConvex: wrap your app in <DualMockConvexProvider>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function DualMockConvexProvider({
  unclassUrl,
  restrictedUrl,
  children,
}: {
  unclassUrl: string;
  restrictedUrl: string;
  children: ReactNode;
}) {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(
    () => ({ unclassUrl, restrictedUrl, version }),
    [unclassUrl, restrictedUrl, version],
  );

  // Auto-refresh every 5s (management dashboard doesn't need real-time speed)
  useEffect(() => {
    const id = setInterval(bump, 5000);
    return () => clearInterval(id);
  }, [bump]);

  return (
    <DualConvexContext.Provider value={value}>
      <BumpContext.Provider value={bump}>{children}</BumpContext.Provider>
    </DualConvexContext.Provider>
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

async function fetchQuery(
  url: string,
  path: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${url}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args }),
  });
  if (!res.ok) return undefined;
  const json: ApiResponse = await res.json();
  return json.status === "success" ? json.value : undefined;
}

async function fetchMutation(
  url: string,
  path: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${url}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args }),
  });
  const json: ApiResponse = await res.json();
  if (json.status === "error") throw new Error(json.errorMessage ?? "Mutation failed");
  return json.value;
}

async function fetchAction(
  url: string,
  path: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${url}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args }),
  });
  const json: ApiResponse = await res.json();
  if (json.status === "error") throw new Error(json.errorMessage ?? "Action failed");
  return json.value;
}

// ---------------------------------------------------------------------------
// useQueryUnclass / useQueryRestricted
// ---------------------------------------------------------------------------
function useQuerySide(
  side: "unclass" | "restricted",
  ref: any,
  args?: Record<string, unknown> | "skip",
): any {
  const { unclassUrl, restrictedUrl, version } = useDualConvex();
  const url = side === "unclass" ? unclassUrl : restrictedUrl;
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
    fetchQuery(url, path, JSON.parse(argsJson))
      .then((val) => {
        if (!cancelled) setData(val);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url, path, argsJson, version, skip]);

  return data;
}

export function useQueryUnclass(ref: any, args?: Record<string, unknown> | "skip"): any {
  return useQuerySide("unclass", ref, args);
}

export function useQueryRestricted(ref: any, args?: Record<string, unknown> | "skip"): any {
  return useQuerySide("restricted", ref, args);
}

// ---------------------------------------------------------------------------
// useMutation / useAction (target a specific side)
// ---------------------------------------------------------------------------
export function useMutationUnclass(
  ref: any,
): (args: Record<string, unknown>) => Promise<any> {
  const { unclassUrl } = useDualConvex();
  const bump = useContext(BumpContext);
  const path = resolvePath(ref);

  return useCallback(
    async (args: Record<string, unknown>) => {
      const result = await fetchMutation(unclassUrl, path, args);
      bump();
      return result;
    },
    [unclassUrl, path, bump],
  );
}

export function useMutationRestricted(
  ref: any,
): (args: Record<string, unknown>) => Promise<any> {
  const { restrictedUrl } = useDualConvex();
  const bump = useContext(BumpContext);
  const path = resolvePath(ref);

  return useCallback(
    async (args: Record<string, unknown>) => {
      const result = await fetchMutation(restrictedUrl, path, args);
      bump();
      return result;
    },
    [restrictedUrl, path, bump],
  );
}

export function useActionRestricted(
  ref: any,
): (args: Record<string, unknown>) => Promise<any> {
  const { restrictedUrl } = useDualConvex();
  const bump = useContext(BumpContext);
  const path = resolvePath(ref);

  return useCallback(
    async (args: Record<string, unknown>) => {
      const result = await fetchAction(restrictedUrl, path, args);
      bump();
      return result;
    },
    [restrictedUrl, path, bump],
  );
}

// ---------------------------------------------------------------------------
// Direct fetch helpers (for health checks that bypass Convex protocol)
// ---------------------------------------------------------------------------
export function useBump(): () => void {
  return useContext(BumpContext);
}

export function useUrls(): { unclassUrl: string; restrictedUrl: string } {
  const { unclassUrl, restrictedUrl } = useDualConvex();
  return { unclassUrl, restrictedUrl };
}
