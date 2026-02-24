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
  authority: string;
  clientId: string;
  redirectUri: string;
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

  const realmAccess = (profile as Record<string, unknown>)["realm_access"] as
    | { roles?: string[] }
    | undefined;
  const roles = realmAccess?.roles?.filter(
    (r) => !r.startsWith("default-roles-") && r !== "offline_access" && r !== "uma_authorization"
  ) ?? [];

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

  useEffect(() => {
    const isCallback = window.location.pathname === "/callback" ||
      window.location.search.includes("code=");

    if (isCallback && !callbackProcessed.current) {
      callbackProcessed.current = true;
      userManager
        .signinRedirectCallback()
        .then((user) => {
          setOidcUser(user);
          window.history.replaceState({}, document.title, "/");
          setIsLoading(false);
        })
        .catch((err) => {
          console.error("OIDC callback error:", err);
          userManager.getUser().then((u) => {
            if (u && !u.expired) setOidcUser(u);
            setIsLoading(false);
          }).catch(() => setIsLoading(false));
        });
    } else if (!isCallback) {
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

    const onUserLoaded = (user: User) => setOidcUser(user);
    const onUserUnloaded = () => setOidcUser(null);

    userManager.events.addUserLoaded(onUserLoaded);
    userManager.events.addUserUnloaded(onUserUnloaded);

    return () => {
      userManager.events.removeUserLoaded(onUserLoaded);
      userManager.events.removeUserUnloaded(onUserUnloaded);
    };
  }, [userManager]);

  const login = useCallback(
    () => userManager.signinRedirect(),
    [userManager]
  );

  const logout = useCallback(
    () => userManager.signoutRedirect(),
    [userManager]
  );

  const user = oidcUser ? mapUser(oidcUser) : null;

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
