/**
 * OIDC Auth Provider — wraps oidc-client-ts in React context.
 * Generic provider used by all VMS React apps.
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { UserManager, User, WebStorageStateStore } from "oidc-client-ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  /** Keycloak subject ID */
  sub: string;
  /** Display name */
  name: string;
  /** Given name */
  firstName: string;
  /** Family name */
  lastName: string;
  email: string;
  /** Realm roles from Keycloak */
  roles: string[];
  /** Raw access token (JWT) */
  accessToken: string;
  /** Custom claims / attributes */
  attributes: Record<string, string>;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  /** Raw OIDC user object */
  oidcUser: User | null;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
  oidcUser: null,
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface OidcConfig {
  authority: string; // e.g. http://localhost:8180/realms/id-porten
  clientId: string; // e.g. vms-portal
  redirectUri: string; // e.g. http://localhost:5173/callback
  postLogoutRedirectUri: string;
  scope?: string;
}

function createUserManager(config: OidcConfig): UserManager {
  return new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    post_logout_redirect_uri: config.postLogoutRedirectUri,
    response_type: "code",
    scope: config.scope ?? "openid profile email",
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    automaticSilentRenew: true,
  });
}

// ---------------------------------------------------------------------------
// Map OIDC User -> AuthUser
// ---------------------------------------------------------------------------

function mapUser(oidcUser: User): AuthUser {
  const profile = oidcUser.profile;

  // Keycloak puts realm roles in realm_access.roles
  const realmAccess = (profile as Record<string, unknown>)["realm_access"] as
    | { roles?: string[] }
    | undefined;
  const roles = realmAccess?.roles?.filter(
    (r) => !r.startsWith("default-roles-") && r !== "offline_access" && r !== "uma_authorization"
  ) ?? [];

  // Gather custom attributes from token claims
  const attributes: Record<string, string> = {};
  for (const key of ["employee_id", "unit_id", "site_id", "pid", "security_level"]) {
    const val = (profile as Record<string, unknown>)[key];
    if (val != null) attributes[key] = String(val);
  }

  return {
    sub: profile.sub,
    name: profile.name ?? `${profile.given_name ?? ""} ${profile.family_name ?? ""}`.trim(),
    firstName: (profile.given_name as string) ?? "",
    lastName: (profile.family_name as string) ?? "",
    email: (profile.email as string) ?? "",
    roles,
    accessToken: oidcUser.access_token,
    attributes,
  };
}

// ---------------------------------------------------------------------------
// Provider Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dev bypass mock users (used when Keycloak is not running)
// ---------------------------------------------------------------------------

const DEV_USERS: Record<string, AuthUser> = {
  "sponsor.hansen": {
    sub: "dev-sponsor-hansen",
    name: "Kari Hansen",
    firstName: "Kari",
    lastName: "Hansen",
    email: "kari.hansen@forsvaret.no",
    roles: ["sponsor"],
    accessToken: "dev-token-sponsor",
    attributes: { employee_id: "FD-1001" },
  },
  "sponsor.dahl": {
    sub: "dev-sponsor-dahl",
    name: "Lise Dahl",
    firstName: "Lise",
    lastName: "Dahl",
    email: "lise.dahl@forsvaret.no",
    roles: ["sponsor"],
    accessToken: "dev-token-sponsor-2",
    attributes: { employee_id: "FD-1002" },
  },
};

export function AuthProvider({
  config,
  children,
}: {
  config: OidcConfig;
  children: ReactNode;
}) {
  const [userManager] = useState(() => createUserManager(config));
  const [oidcUser, setOidcUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const callbackProcessed = useRef(false);

  // Dev bypass state
  const [devUser, setDevUser] = useState<AuthUser | null>(null);
  const [devBypass, setDevBypass] = useState(false);

  useEffect(() => {
    // Check if we're on the callback URL
    const isCallback = window.location.pathname === "/callback" ||
      window.location.search.includes("code=");

    if (isCallback && !callbackProcessed.current) {
      // Guard against StrictMode double-invocation — the auth code can only be exchanged once.
      callbackProcessed.current = true;
      userManager
        .signinRedirectCallback()
        .then((user) => {
          setOidcUser(user);
          // Clean URL by removing query params
          window.history.replaceState({}, document.title, "/");
          setIsLoading(false);
        })
        .catch((err) => {
          console.error("OIDC callback error:", err);
          // On failure, fall back to checking existing session
          userManager.getUser().then((u) => {
            if (u && !u.expired) setOidcUser(u);
            setIsLoading(false);
          }).catch(() => setIsLoading(false));
        });
    } else if (!isCallback) {
      // Try to load existing session
      userManager
        .getUser()
        .then((user) => {
          if (user && !user.expired) {
            setOidcUser(user);
          }
          setIsLoading(false);
        })
        .catch(() => setIsLoading(false));
    }

    // Listen for token events
    const onUserLoaded = (user: User) => setOidcUser(user);
    const onUserUnloaded = () => setOidcUser(null);

    userManager.events.addUserLoaded(onUserLoaded);
    userManager.events.addUserUnloaded(onUserUnloaded);

    return () => {
      userManager.events.removeUserLoaded(onUserLoaded);
      userManager.events.removeUserUnloaded(onUserUnloaded);
    };
  }, [userManager]);

  const login = useCallback(async () => {
    // Try Keycloak first; if it fails (not running), activate dev bypass
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      await fetch(config.authority + "/.well-known/openid-configuration", {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      // Keycloak is reachable — do normal redirect
      await userManager.signinRedirect();
    } catch {
      // Keycloak not reachable — activate dev bypass picker
      setDevBypass(true);
      setIsLoading(false);
    }
  }, [userManager, config.authority]);

  const logout = useCallback(async () => {
    if (devUser) {
      setDevUser(null);
      setDevBypass(false);
      return;
    }
    await userManager.signoutRedirect();
  }, [userManager, devUser]);

  const user = devUser ?? (oidcUser ? mapUser(oidcUser) : null);

  // Show dev user picker when bypass is active and no user selected
  if (devBypass && !devUser) {
    return (
      <AuthContext.Provider
        value={{ user: null, isLoading: false, isAuthenticated: false, login, logout, oidcUser: null }}
      >
        <div style={{
          maxWidth: 420, margin: "80px auto", padding: 32, fontFamily: "system-ui, sans-serif",
          background: "#1a1a2e", borderRadius: 12, border: "1px solid #333",
        }}>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <span style={{ fontSize: 28, color: "#f59e0b" }}>&#9888;</span>
            <h2 style={{ margin: "8px 0 4px", color: "#e5e5e5" }}>Dev Bypass</h2>
            <p style={{ color: "#999", fontSize: 13, margin: 0 }}>
              Keycloak not reachable — select a test user
            </p>
          </div>
          {Object.entries(DEV_USERS).map(([key, u]) => (
            <button
              key={key}
              onClick={() => setDevUser(u)}
              style={{
                display: "block", width: "100%", padding: "12px 16px", marginBottom: 8,
                background: "#16213e", border: "1px solid #444", borderRadius: 8, cursor: "pointer",
                textAlign: "left", color: "#e5e5e5", fontSize: 14,
              }}
            >
              <strong>{u.name}</strong>
              <span style={{ color: "#888", marginLeft: 8, fontSize: 12 }}>
                {key} — {u.roles.join(", ")}
              </span>
            </button>
          ))}
          <button
            onClick={() => { setDevBypass(false); }}
            style={{
              display: "block", width: "100%", padding: "8px 16px", marginTop: 8,
              background: "transparent", border: "1px solid #555", borderRadius: 8,
              cursor: "pointer", color: "#888", fontSize: 12,
            }}
          >
            Cancel
          </button>
        </div>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        oidcUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
