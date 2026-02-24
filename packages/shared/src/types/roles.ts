/**
 * User roles and permissions for the VMS.
 */

export type UserRole =
  | "reception_guard"
  | "security_officer"
  | "escort"
  | "unit_manager"
  | "site_admin"
  | "auditor"
  | "sponsor"
  | "contractor_admin"
  | "external_visitor";

export interface UserProfile {
  id: string;
  employeeId?: string;
  name: string;
  email: string;
  role: UserRole;
  siteId: string;
  unitId?: string;
}
