/**
 * Notification Sink — captures email and SMS notifications for demo/testing.
 * No actual sending. Stores in memory and provides a simple web UI.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();
const PORT = Number(process.env.PORT ?? "8082");

interface Notification {
  id: number;
  type: "email" | "sms";
  to: string;
  subject?: string;
  body: string;
  sentAt: string;
}

const notifications: Notification[] = [];
let nextId = 1;

// Send email (captured, not actually sent)
app.post("/email/send", async (c) => {
  const body = await c.req.json();
  const notif: Notification = {
    id: nextId++,
    type: "email",
    to: body.to,
    subject: body.subject,
    body: body.body,
    sentAt: new Date().toISOString(),
  };
  notifications.push(notif);
  console.log(`[notification-sink] Email to ${notif.to}: ${notif.subject}`);
  return c.json({ sent: true, id: notif.id });
});

// Send SMS (captured, not actually sent)
app.post("/sms/send", async (c) => {
  const body = await c.req.json();
  const notif: Notification = {
    id: nextId++,
    type: "sms",
    to: body.to,
    body: body.body,
    sentAt: new Date().toISOString(),
  };
  notifications.push(notif);
  console.log(`[notification-sink] SMS to ${notif.to}: ${notif.body.substring(0, 50)}`);
  return c.json({ sent: true, id: notif.id });
});

// List all captured notifications
app.get("/notifications", (c) => {
  return c.json({ count: notifications.length, items: notifications });
});

// Simple web dashboard
app.get("/dashboard", (c) => {
  const rows = notifications
    .map(
      (n) =>
        `<tr><td>${n.id}</td><td>${n.type}</td><td>${n.to}</td><td>${n.subject ?? "-"}</td><td>${n.body.substring(0, 80)}</td><td>${n.sentAt}</td></tr>`,
    )
    .join("\n");

  return c.html(`<!doctype html>
<html><head><title>Notification Sink</title></head>
<body>
<h1>Notification Sink</h1>
<p>${notifications.length} notifications captured.</p>
<table border="1" cellpadding="4">
<tr><th>ID</th><th>Type</th><th>To</th><th>Subject</th><th>Body</th><th>Sent At</th></tr>
${rows}
</table>
<form method="POST" action="/notifications/clear"><button>Clear All</button></form>
</body></html>`);
});

// Clear all notifications
app.post("/notifications/clear", (c) => {
  notifications.length = 0;
  nextId = 1;
  return c.redirect("/dashboard");
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

console.log(`[notification-sink] Starting on port ${PORT}`);
serve({ fetch: app.fetch, port: PORT });
