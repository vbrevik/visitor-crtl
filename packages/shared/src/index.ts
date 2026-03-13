export * from "./types/index.js";
export * from "./diode/index.js";
export * from "./identity-scoring.js";
export { isAllowed } from "./abac.js";
export type { AbacAction, ResourceContext } from "./abac.js";
// NOTE: xml/envelope.ts uses node:crypto — import from "@vms/shared/xml" directly in Node.js contexts
