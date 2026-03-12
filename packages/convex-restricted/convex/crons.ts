import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Ship audit events to Splunk every 5 minutes
crons.interval(
  "ship audit events to Splunk",
  { minutes: 5 },
  internal.auditShipping.shipAuditEvents,
);

export default crons;
