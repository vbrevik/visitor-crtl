import type { OidcConfig } from "./AuthProvider";

const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL ?? "http://localhost:8180";

export const oidcConfig: OidcConfig = {
  authority: `${KEYCLOAK_URL}/realms/mil-feide`,
  clientId: "vms-security",
  redirectUri: `${window.location.origin}/callback`,
  postLogoutRedirectUri: window.location.origin,
  scope: "openid profile email",
};
