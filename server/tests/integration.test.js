import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import bcrypt from "bcryptjs";
import request from "supertest";
process.env.JWT_SECRET = "integration-test-secret-is-at-least-32-characters";
process.env.APP_ORIGIN = "http://localhost:5173";
process.env.EMAIL_WEBHOOK_SECRET = "integration-email-secret";
process.env.UPLOAD_DIR = "/tmp/ticketflow-test-uploads";
const { pool } = await import("../src/db.js");
const db = new PGlite();
pool.query = (...a) => db.query(...a);
pool.connect = async () => ({
  query: (...a) => db.query(...a),
  release: () => {},
});
for (const f of [
  "001_initial.sql",
  "002_sla_history.sql",
  "003_account_security.sql",
])
  await db.exec(
    await fs.readFile(new URL("../migrations/" + f, import.meta.url), "utf8"),
  );
const { app } = await import("../src/app.js");
const { tick } = await import("../src/worker.js");
const calendar = {
  timezone: "UTC",
  days: [1, 2, 3, 4, 5, 6, 7],
  start: "00:00",
  end: "23:59",
  holidays: [],
};
const configs = {
  branding: { name: "Test", colour: "#2563eb" },
  calendar,
  categories: ["General"],
  statuses: [
    "New",
    "Assigned",
    "In Progress",
    "Waiting on Client",
    "Resolved",
    "Closed",
  ],
  workflow: {
    reopenDays: 7,
    autoCloseDays: 3,
    assignment: "workload",
    warningThreshold: 0.75,
  },
  templates: [],
  modules: {},
  articles: [],
  customFields: [],
};
for (const [k, v] of Object.entries(configs))
  await db.query("INSERT INTO settings VALUES($1,$2)", [k, JSON.stringify(v)]);
await db.query("INSERT INTO packages(name,targets) VALUES($1,$2)", [
  "Basic",
  JSON.stringify(
    Object.fromEntries(
      ["Low", "Medium", "High", "Critical"].map((p) => [
        p,
        { response: 60, resolution: 240 },
      ]),
    ),
  ),
]);
await db.exec(
  "INSERT INTO organisations(name,package_id) VALUES('Org A',1),('Org B',1)",
);
const hash = await bcrypt.hash("TestingPassword123!", 4);
for (const [name, role, org] of [
  ["admin", "admin", null],
  ["agent", "agent", null],
  ["client", "client", 1],
  ["other", "client", 2],
])
  await db.query(
    "INSERT INTO users(name,email,password,role,organisation_id) VALUES($1,$2,$3,$4,$5)",
    [name, name + "@test.com", hash, role, org],
  );
async function login(name) {
  const a = request.agent(app);
  const r = await a
    .post("/api/auth/login")
    .send({ email: name + "@test.com", password: "TestingPassword123!" });
  assert.equal(r.status, 200);
  return a;
}
test("end-to-end lifecycle, isolation, audit, email, assignment and durable worker", async () => {
  const client = await login("client"),
    other = await login("other"),
    admin = await login("admin"),
    agent = await login("agent");
  let r = await client
    .post("/api/tickets")
    .send({
      title: "Cannot sign in",
      description: "Login is failing repeatedly",
      category: "General",
      priority: "Medium",
      organisation_id: 2,
    });
  assert.equal(r.status, 201);
  const id = r.body.id;
  assert.equal(r.body.organisation_id, 1);
  assert.equal(r.body.assignee_id, 2);
  assert.match(r.body.number, /^TF-/);
  assert.equal((await other.get("/api/tickets/" + id)).status, 404);
  assert.equal((await other.get("/api/tickets")).body.length, 0);
  assert.equal(
    (
      await client
        .put("/api/admin/settings/branding")
        .send({ value: { name: "Bad", colour: "#ffffff" } })
    ).status,
    403,
  );
  assert.equal(
    (
      await client
        .post("/api/tickets/" + id + "/comments")
        .send({ body: "Secret", internal: true })
    ).status,
    403,
  );
  assert.equal(
    (
      await agent
        .post("/api/tickets/" + id + "/comments")
        .send({ body: "Private diagnostic", internal: true })
    ).status,
    201,
  );
  assert.equal(
    (await client.get("/api/tickets/" + id)).body.comments.length,
    0,
  );
  assert.equal(
    (await client.get("/api/tickets/" + id)).body.responded_at,
    null,
  );
  assert.equal(
    (
      await agent
        .post("/api/tickets/" + id + "/comments")
        .send({ body: "Investigating the login issue" })
    ).status,
    201,
  );
  assert.ok((await client.get("/api/tickets/" + id)).body.responded_at);
  assert.equal(
    (await agent.patch("/api/tickets/" + id).send({ assignee_id: 1 })).status,
    403,
  );
  assert.equal(
    (
      await agent
        .patch("/api/tickets/" + id)
        .send({ status: "Waiting on Client" })
    ).status,
    200,
  );
  await db.query(
    "UPDATE tickets SET last_tick=now()-interval '2 hours' WHERE id=$1",
    [id],
  );
  const before = (await client.get("/api/tickets/" + id)).body.sla.elapsed;
  await tick();
  assert.equal(
    (await client.get("/api/tickets/" + id)).body.sla.elapsed,
    before,
  );
  await client
    .post("/api/tickets/" + id + "/comments")
    .send({ body: "Here are the additional details" });
  assert.equal(
    (await client.get("/api/tickets/" + id)).body.status,
    "In Progress",
  );
  const file = await client
    .post("/api/tickets/" + id + "/attachments")
    .attach("file", Buffer.from("diagnostic details"), "details.txt");
  assert.equal(file.status, 201);
  assert.equal(
    (await other.get("/api/attachments/" + file.body.id)).status,
    404,
  );
  assert.equal(
    (await client.get("/api/attachments/" + file.body.id)).status,
    200,
  );
  assert.equal(
    (await agent.patch("/api/tickets/" + id).send({ status: "Resolved" }))
      .status,
    200,
  );
  assert.equal(
    (await client.patch("/api/tickets/" + id).send({ rating: 5 })).status,
    200,
  );
  assert.equal(
    (await client.patch("/api/tickets/" + id).send({ status: "New" })).status,
    200,
  );
  assert.equal((await client.get("/api/tickets/" + id)).body.resolved_at, null);
  await db.query(
    "UPDATE tickets SET elapsed_minutes=300,last_tick=now() WHERE id=$1",
    [id],
  );
  await tick();
  assert.equal(
    (await db.query("SELECT breach_sent FROM tickets WHERE id=$1", [id]))
      .rows[0].breach_sent,
    true,
  );
  const notifications = (await db.query("SELECT count(*) n FROM notifications"))
    .rows[0].n;
  await tick();
  assert.equal(
    (await db.query("SELECT count(*) n FROM notifications")).rows[0].n,
    notifications,
  );
  const email = {
    messageId: "email-001",
    from: "client@test.com",
    subject: "Email request",
    text: "A ticket created from email",
  };
  r = await request(app)
    .post("/api/integrations/email")
    .set("x-webhook-secret", process.env.EMAIL_WEBHOOK_SECRET)
    .send(email);
  assert.equal(r.status, 201);
  const duplicate = await request(app)
    .post("/api/integrations/email")
    .set("x-webhook-secret", process.env.EMAIL_WEBHOOK_SECRET)
    .send(email);
  assert.equal(duplicate.body.id, r.body.id);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(
    (await request(app).post("/api/integrations/email").send(email)).status,
    401,
  );
  assert.equal((await admin.get("/api/reports")).status, 200);
  assert.equal((await client.get("/api/reports")).status, 403);
  await assert.rejects(() => db.query("DELETE FROM audit"));
  assert.equal(
    (
      await client
        .post("/api/tickets")
        .set("Origin", "https://evil.example")
        .send({})
    ).status,
    403,
  );
  assert.equal(
    (
      await admin
        .put("/api/admin/settings/calendar")
        .send({ value: { ...calendar, end: "00:00" } })
    ).status,
    400,
  );
  const enrollment = await agent
    .post("/api/auth/mfa/enroll")
    .send({ password: "TestingPassword123!" });
  assert.equal(enrollment.status, 200);
  const { code } = await import("../src/mfa.js");
  assert.equal(
    (
      await agent
        .post("/api/auth/mfa/confirm")
        .send({ otp: code(enrollment.body.secret) })
    ).status,
    200,
  );
  assert.equal((await agent.get("/api/auth/me")).status, 401);
  assert.equal(
    (
      await request(app)
        .post("/api/auth/login")
        .send({ email: "agent@test.com", password: "TestingPassword123!" })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/auth/login")
        .send({
          email: "agent@test.com",
          password: "TestingPassword123!",
          otp: code(enrollment.body.secret),
        })
    ).status,
    200,
  );
  assert.equal(
    (
      await other
        .post("/api/auth/password")
        .send({
          current: "TestingPassword123!",
          password: "ReplacementPassword123!",
        })
    ).status,
    200,
  );
  assert.equal((await other.get("/api/auth/me")).status, 401);
  await db.close();
  await fs.rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
