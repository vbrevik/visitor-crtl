/**
 * Diode message types — defines what crosses the air gap.
 * Data minimization: only the minimum necessary fields cross the boundary.
 */

export type DiodeDirection = "unclass_to_restricted" | "restricted_to_unclass";

export type DiodeMessageType =
  // Unclassified → Restricted
  | "VISITOR_REQUEST"
  | "VISITOR_UPDATE"
  | "VISITOR_CANCEL"
  // Restricted → Unclassified
  | "VISIT_STATUS_UPDATE"
  | "VISIT_APPROVED"
  | "VISIT_DENIED"
  | "BADGE_ISSUED"
  | "VISIT_COMPLETED";

export interface DiodeEnvelope {
  messageId: string;
  messageType: DiodeMessageType;
  direction: DiodeDirection;
  sourceSiteId: string;
  timestamp: string; // ISO 8601
  correlationId: string; // Links request ↔ response
  payload: string; // Serialized XML or JSON
  checksum: string; // SHA-256 of payload
}

/** Payload for VISITOR_REQUEST (crosses unclass → restricted) */
export interface VisitorRequestPayload {
  requestId: string;
  visitorType: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  companyName?: string;
  companyOrgNumber?: string;
  purpose: string;
  siteId: string;
  dateFrom: string;
  dateTo: string;
  sponsorEmployeeId?: string;
  sponsorName?: string;
  identityScore: number;
  identitySources: string[];
  // NOTE: No fødselsnummer, no clearance data — data minimization
}

/** Payload for VISIT_STATUS_UPDATE (crosses restricted → unclass) */
export interface VisitStatusPayload {
  requestId: string;
  status: string;
  message?: string;
  updatedAt: string;
}

/** Payload for VISIT_APPROVED (crosses restricted → unclass) */
export interface VisitApprovedPayload {
  requestId: string;
  approvedBy: string; // Role, not name
  dateFrom: string;
  dateTo: string;
  checkInInstructions?: string;
}
