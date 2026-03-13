/**
 * ABAC policy engine — pure functions for authorization decisions.
 *
 * Maps (actor.role, action, resource) → allow/deny.
 * No side effects, no Convex dependencies. Usable in both
 * Convex backends and in test suites.
 *
 * Site scoping: actors can only operate on resources at their assigned site,
 * unless their siteId is "*" (wildcard — server-side only, rejected by parseActor
 * for client-supplied arguments).
 */
import type { Actor } from "./types/auth.js";
import type { UserRole } from "./types/roles.js";

/** Actions that can be authorized. */
export type AbacAction =
  | "visit:read"
  | "visit:transition"
  | "visit:check_in"
  | "visit:check_out"
  | "audit:query"
  | "audit:verify_chain";

/** Resource context for the authorization check. */
export interface ResourceContext {
  siteId: string;
}

/**
 * Permission matrix — which roles can perform which actions.
 * site_admin has all permissions (handled separately).
 *
 * contractor_admin and external_visitor have no RESTRICTED-side permissions —
 * they interact via the UNCLASSIFIED side only.
 */
const PERMISSIONS: Record<AbacAction, UserRole[]> = {
  "visit:read": [
    "reception_guard",
    "security_officer",
    "escort",
    "unit_manager",
    "sponsor",
    "auditor",
  ],
  "visit:transition": [
    "security_officer",
    "unit_manager",
  ],
  "visit:check_in": [
    "reception_guard",
  ],
  "visit:check_out": [
    "reception_guard",
  ],
  "audit:query": [
    "security_officer",
    "auditor",
  ],
  "audit:verify_chain": [
    "security_officer",
    "auditor",
  ],
};

/**
 * Check if an actor is allowed to perform an action on a resource.
 *
 * @returns true if allowed, false if denied
 */
export function isAllowed(
  actor: Actor,
  action: AbacAction,
  resource: ResourceContext,
): boolean {
  // Site scoping: actor must be at the same site as the resource,
  // unless actor has wildcard site access.
  if (actor.siteId !== "*" && actor.siteId !== resource.siteId) {
    return false;
  }

  // site_admin can do everything
  if (actor.role === "site_admin") {
    return true;
  }

  const allowedRoles = PERMISSIONS[action];
  return allowedRoles.includes(actor.role);
}
