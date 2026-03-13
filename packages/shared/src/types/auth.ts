/**
 * Actor identity for ABAC authorization.
 * Passed as mutation/query arguments from the frontend auth context.
 *
 * Future: When Convex JWT auth is configured, this will be extracted
 * from ctx.auth.getUserIdentity() instead of mutation arguments.
 */
import type { UserRole } from "./roles.js";

export interface Actor {
  /** User ID (Keycloak subject ID or employee ID). */
  id: string;
  /** User's role from Keycloak realm_access.roles. */
  role: UserRole;
  /** Site the user is currently operating at. */
  siteId: string;
}
