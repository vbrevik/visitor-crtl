/**
 * NAR (Nasjonalt Autorisasjonsregister) consumer types.
 * These represent the external API contract — VMS treats NAR as an opaque service.
 */

/** Security classification levels */
export type SecurityLevel =
  | "UGRADERT"
  | "BEGRENSET"
  | "KONFIDENSIELT"
  | "HEMMELIG"
  | "STRENGT_HEMMELIG";

/** What the consumer sees of an access scope — display-safe, no internal details */
export interface NarAccessScope {
  scopeId: string;
  scopeType: "zone" | "area" | "room" | "group" | "project";
  displayName: string;  // e.g., "Building 4" — never internal zone codes
  classification: SecurityLevel;
}

/** Time-based constraints on the authorization */
export interface NarTimeWindow {
  days?: string;    // e.g., "mon-fri"
  from?: string;    // e.g., "07:00"
  to?: string;      // e.g., "17:00"
}

/** Validity period for an authorization */
export type NarValidityPeriod =
  | { type: "single-day"; date: string }
  | { type: "period"; from: string; to: string }
  | { type: "permanent" };

/** Constraints attached to an authorization */
export interface NarAccessConstraints {
  escortRequired: boolean;
  timeWindows?: NarTimeWindow[];
  maxClassification: SecurityLevel;
}

/** A single physical access authorization as returned by NAR */
export interface NarPhysicalAuthorization {
  authorizationId: string;
  personId: string;
  siteId: string;
  scope: NarAccessScope;
  constraints: NarAccessConstraints;
  validity: NarValidityPeriod;
  status: "active" | "expired" | "revoked";
}

/** Response from NAR query endpoint */
export interface NarAuthorizationResponse {
  found: boolean;
  authorizations: NarPhysicalAuthorization[];
}

/** Response from NAR check endpoint */
export interface NarAccessCheckResponse {
  authorized: boolean;
  escortRequired: boolean;
  reason?: string;  // e.g., "authorization expired", "no authorization for scope"
  authorization?: NarPhysicalAuthorization;  // included if authorized
}
