/**
 * Core visitor types shared across unclassified and restricted sides.
 */

export type VisitorType = "external" | "in_house" | "contractor";

export type VisitStatus =
  | "draft"
  | "submitted"
  | "received"
  | "verifying"
  | "verified"
  | "flagged_for_review"
  | "denied"
  | "approved"
  | "day_of_check"
  | "ready_for_arrival"
  | "checked_in"
  | "active"
  | "suspended"
  | "checked_out"
  | "completed"
  | "cancelled"
  | "no_show";

export type ApprovalTier = "auto" | "sponsor" | "security_officer" | "site_commander";

export interface VisitRequest {
  visitorType: VisitorType;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  companyName?: string;
  companyOrgNumber?: string;
  purpose: string;
  siteId: string;
  requestedDateFrom: string; // ISO date
  requestedDateTo: string;
  sponsorEmployeeId?: string;
  sponsorName?: string;
  identityScore: number;
  identitySources: IdentitySource[];
}

export type IdentitySource =
  | "id_porten"
  | "mil_feide"
  | "passport"
  | "fido2"
  | "totp"
  | "sms_otp"
  | "email_verified"
  | "in_person";

export interface Visit {
  id: string;
  status: VisitStatus;
  visitorType: VisitorType;
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
  escortEmployeeId?: string;
  escortName?: string;
  identityScore: number;
  identitySources: IdentitySource[];
  approvalTier: ApprovalTier;
  badgeId?: string;
  accessLevelIds?: string[];
  createdAt: string;
  updatedAt: string;
}
