import { pool, tx } from "./db.js";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
const password =
  process.env.SEED_PASSWORD || randomBytes(12).toString("base64url");
await tx(async (c) => {
  if ((await c.query("SELECT 1 FROM users LIMIT 1")).rowCount) {
    console.log("Already seeded");
    return;
  }
  const settings = {
    branding: { name: "TicketFlow", colour: "#2563eb" },
    categories: ["Technical", "Billing", "Account", "General"],
    statuses: [
      "New",
      "Assigned",
      "In Progress",
      "Waiting on Client",
      "Resolved",
      "Closed",
    ],
    calendar: {
      timezone: "Asia/Kolkata",
      days: [1, 2, 3, 4, 5],
      start: "09:00",
      end: "18:00",
      holidays: [],
    },
    workflow: {
      reopenDays: 7,
      autoCloseDays: 3,
      assignment: "workload",
      warningThreshold: 0.75,
    },
    templates: [
      "Thank you for contacting us. We are investigating your issue.",
      "Your issue has been resolved. Please let us know if you need anything else.",
    ],
    modules: { knowledgeBase: true },
    articles: [
      {
        title: "How to reset your password",
        body: "Contact your support administrator to reset your account password.",
      },
    ],
    customFields: [],
  };
  for (const [k, v] of Object.entries(settings))
    await c.query("INSERT INTO settings VALUES($1,$2)", [k, JSON.stringify(v)]);
  for (const [name, factor] of [
    ["Basic", 4],
    ["Premium", 2],
    ["Enterprise", 1],
  ]) {
    const targets = Object.fromEntries(
      [
        ["Critical", 15, 120],
        ["High", 60, 480],
        ["Medium", 240, 1440],
        ["Low", 480, 2880],
      ].map(([p, r, s]) => [
        p,
        { response: r * factor, resolution: s * factor },
      ]),
    );
    await c.query("INSERT INTO packages(name,targets) VALUES($1,$2)", [
      name,
      JSON.stringify(targets),
    ]);
  }
  await c.query(
    "INSERT INTO organisations(name,package_id) VALUES('Acme Technologies',2),('Northstar Studio',1)",
  );
  const hash = await bcrypt.hash(password, 12);
  for (const [name, email, role, org] of [
    ["Administrator", "admin@example.com", "admin", null],
    ["Maya Chen", "manager@example.com", "manager", null],
    ["Ravi Kumar", "lead@example.com", "lead", null],
    ["Alex Morgan", "agent@example.com", "agent", null],
    ["Sam Taylor", "client@example.com", "client", 1],
    ["Jamie Park", "other@example.com", "client", 2],
  ])
    await c.query(
      "INSERT INTO users(name,email,password,role,organisation_id) VALUES($1,$2,$3,$4,$5)",
      [name, email, hash, role, org],
    );
  console.log("Demo accounts seeded. Password:", password);
});
await pool.end();
