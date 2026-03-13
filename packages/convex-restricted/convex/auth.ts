/**
 * Authentication helper for RESTRICTED Convex backend.
 *
 * Validates actor identity passed as mutation/query arguments.
 * Returns a typed Actor for use in ABAC checks and audit logging.
 *
 * Future: When Convex JWT auth is configured (auth.config.ts + Keycloak),
 * this will extract identity from ctx.auth.getUserIdentity() instead.
 * The ABAC policy checks remain identical — only the identity source changes.
 */
import { v } from "convex/values";
import type { UserRole } from "@vms/shared";

/** Actor identity — matches @vms/shared Actor type. */
interface Actor {
  id: string;
  role: UserRole;
  siteId: string;
}

/** Valid roles — must match UserRole type. */
const VALID_ROLES: string[] = [
  "reception_guard",
  "security_officer",
  "escort",
  "unit_manager",
  "site_admin",
  "auditor",
  "sponsor",
  "contractor_admin",
  "external_visitor",
];

/** Convex validators for actor arguments — spread into mutation/query args. */
export const actorArgs = {
  actorId: v.string(),
  actorRole: v.string(),
  actorSiteId: v.string(),
};

/**
 * Parse and validate actor arguments into a typed Actor.
 * Throws if any field is missing or invalid.
 *
 * Rejects wildcard siteId ("*") — only server-side code (internal mutations)
 * should use wildcard, and those don't go through parseActor.
 */
export function parseActor(args: {
  actorId: string;
  actorRole: string;
  actorSiteId: string;
}): Actor {
  if (!args.actorId) {
    throw new Error("actorId is required");
  }
  if (!VALID_ROLES.includes(args.actorRole)) {
    throw new Error(`Invalid role: ${args.actorRole}`);
  }
  if (!args.actorSiteId) {
    throw new Error("actorSiteId is required");
  }
  if (args.actorSiteId === "*") {
    throw new Error("Wildcard siteId is not allowed in client arguments");
  }

  return {
    id: args.actorId,
    role: args.actorRole as UserRole,
    siteId: args.actorSiteId,
  };
}
