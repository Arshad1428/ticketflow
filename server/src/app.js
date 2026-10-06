import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { pool, tx } from "./db.js";
import { effectiveElapsed, slaState } from "./sla.js";
import { validateLicense } from "./license.js";
import { runHook } from "./modules/index.js";
import { scan } from "./scanner.js";
import { secret, valid, encrypt, decrypt } from "./mfa.js";
export const app = express();
app.use(
  helmet({
    contentSecurityPolicy:
      process.env.NODE_ENV === "production" ? undefined : false,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api", rateLimit({ windowMs: 60000, limit: 200 }));
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
export const error = (status, message) =>
  Object.assign(new Error(message), { status });
const staff = (u) => u.role !== "client";
const manage = (u) => ["admin", "manager", "lead"].includes(u.role);
const admin = (req, res, next) =>
  req.user.role === "admin"
    ? next()
    : next(error(403, "Administrator access required"));
export async function config(c = pool) {
  return Object.fromEntries(
    (await c.query("SELECT * FROM settings")).rows.map((s) => [s.key, s.value]),
  );
}
export async function audit(c, user, ticket, action, details = {}) {
  await c.query(
    "INSERT INTO audit(user_id,ticket_id,action,details) VALUES($1,$2,$3,$4)",
    [user, ticket, action, JSON.stringify(details)],
  );
}
export async function notify(c, t, message) {
  const recipients = (
    await c.query(
      "SELECT id,email FROM users WHERE active AND (organisation_id=$1 OR id=$2 OR role IN ('lead','manager','admin'))",
      [t.organisation_id, t.assignee_id],
    )
  ).rows;
  for (const u of recipients) {
    await c.query(
      "INSERT INTO notifications(user_id,ticket_id,message) VALUES($1,$2,$3)",
      [u.id, t.id, message],
    );
    await c.query("INSERT INTO outbox(email,subject,body) VALUES($1,$2,$3)", [
      u.email,
      `${t.number}: ${message}`,
      `${t.title}\n${message}`,
    ]);
  }
}
app.get(
  "/api/health",
  wrap(async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  }),
);
app.use("/api", (req, res, next) => {
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
    req.path !== "/integrations/email" &&
    req.headers.origin &&
    req.headers.origin !== process.env.APP_ORIGIN
  )
    return next(error(403, "Origin rejected"));
  next();
});
app.post(
  "/api/auth/login",
  rateLimit({ windowMs: 900000, limit: 20 }),
  wrap(async (req, res) => {
    const { email, password, otp } = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
        otp: z.string().optional(),
      })
      .parse(req.body);
    const u = (
      await pool.query("SELECT * FROM users WHERE email=$1 AND active", [
        email.toLowerCase(),
      ])
    ).rows[0];
    if (!u || !(await bcrypt.compare(password, u.password)))
      throw error(401, "Invalid email or password");
    if (u.mfa_secret && !valid(decrypt(u.mfa_secret), otp))
      throw error(401, "Enter the six-digit authenticator code");
    const token = jwt.sign(
      { id: u.id, v: u.auth_version },
      process.env.JWT_SECRET,
      { expiresIn: "8h" },
    );
    res.cookie("session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 28800000,
    });
    res.json({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      organisation_id: u.organisation_id,
      mfa_enabled: !!u.mfa_secret,
    });
  }),
);
// Authenticated email-provider webhook. Provider adapter must normalize and verify original signatures.
app.post(
  "/api/integrations/email",
  wrap(async (req, res) => {
    const expected = process.env.EMAIL_WEBHOOK_SECRET || "";
    const actual = req.headers["x-webhook-secret"] || "";
    if (
      !expected ||
      Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    )
      throw error(401, "Invalid webhook secret");
    const body = z
      .object({
        messageId: z.string().min(1).max(255),
        from: z.string().email(),
        subject: z.string().min(1).max(200),
        text: z.string().min(1).max(20000),
      })
      .parse(req.body);
    const result = await tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        body.messageId,
      ]);
      const old = (
        await c.query(
          "SELECT ticket_id FROM email_receipts WHERE message_id=$1",
          [body.messageId],
        )
      ).rows[0];
      if (old) return { id: old.ticket_id, duplicate: true };
      const u = (
        await c.query(
          "SELECT * FROM users WHERE email=$1 AND role='client' AND active",
          [body.from.toLowerCase()],
        )
      ).rows[0];
      if (!u) throw error(400, "Sender must be a registered client");
      const t = await createTicket(
        c,
        u,
        {
          title: body.subject,
          description: body.text,
          category: "General",
          priority: "Medium",
        },
        "email",
      );
      await c.query("INSERT INTO email_receipts VALUES($1,$2)", [
        body.messageId,
        t.id,
      ]);
      return t;
    });
    res.status(201).json(result);
  }),
);
app.use(
  "/api",
  wrap(async (req, res, next) => {
    try {
      const token = req.cookies.session;
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const u = (
        await pool.query(
          "SELECT id,name,email,role,organisation_id,auth_version,(mfa_secret IS NOT NULL) mfa_enabled FROM users WHERE id=$1 AND active",
          [payload.id],
        )
      ).rows[0];
      if (!u || payload.v !== u.auth_version) throw Error();
      req.user = u;
      next();
    } catch {
      throw error(401, "Please sign in");
    }
  }),
);
app.use("/api", (req, res, next) => {
  try {
    validateLicense();
    next();
  } catch (e) {
    next(error(403, e.message));
  }
});
app.get("/api/auth/me", (req, res) => res.json(req.user));
app.post("/api/auth/logout", (req, res) =>
  res.clearCookie("session").json({ ok: true }),
);
app.post(
  "/api/auth/password",
  wrap(async (req, res) => {
    const b = z
      .object({ current: z.string(), password: z.string().min(12).max(200) })
      .parse(req.body);
    const u = (
      await pool.query("SELECT password FROM users WHERE id=$1", [req.user.id])
    ).rows[0];
    if (!(await bcrypt.compare(b.current, u.password)))
      throw error(400, "Current password is incorrect");
    await pool.query(
      "UPDATE users SET password=$1,auth_version=auth_version+1 WHERE id=$2",
      [await bcrypt.hash(b.password, 12), req.user.id],
    );
    res.json({ ok: true });
  }),
);
app.post(
  "/api/auth/mfa/enroll",
  wrap(async (req, res) => {
    const u = (
      await pool.query("SELECT password,mfa_secret FROM users WHERE id=$1", [
        req.user.id,
      ])
    ).rows[0];
    if (!(await bcrypt.compare(String(req.body.password || ""), u.password)))
      throw error(403, "Password confirmation required");
    if (u.mfa_secret) throw error(400, "MFA is already enabled");
    const s = secret();
    await pool.query("UPDATE users SET mfa_pending=$1 WHERE id=$2", [
      encrypt(s),
      req.user.id,
    ]);
    res.json({
      secret: s,
      uri:
        "otpauth://totp/TicketFlow:" +
        encodeURIComponent(req.user.email) +
        "?secret=" +
        s +
        "&issuer=TicketFlow&algorithm=SHA1&digits=6&period=30",
    });
  }),
);
app.post(
  "/api/auth/mfa/confirm",
  wrap(async (req, res) => {
    await tx(async (c) => {
      const u = (
        await c.query("SELECT mfa_pending FROM users WHERE id=$1 FOR UPDATE", [
          req.user.id,
        ])
      ).rows[0];
      if (!u.mfa_pending || !valid(decrypt(u.mfa_pending), req.body.otp))
        throw error(400, "Invalid authenticator code");
      await c.query(
        "UPDATE users SET mfa_secret=mfa_pending,mfa_pending=NULL,auth_version=auth_version+1 WHERE id=$1",
        [req.user.id],
      );
      await audit(c, req.user.id, null, "MFA enabled");
    });
    res.clearCookie("session").json({ ok: true });
  }),
);
app.post(
  "/api/auth/mfa/disable",
  wrap(async (req, res) => {
    await tx(async (c) => {
      const u = (
        await c.query(
          "SELECT password,mfa_secret FROM users WHERE id=$1 FOR UPDATE",
          [req.user.id],
        )
      ).rows[0];
      if (
        !u.mfa_secret ||
        !(await bcrypt.compare(String(req.body.password || ""), u.password)) ||
        !valid(decrypt(u.mfa_secret), req.body.otp)
      )
        throw error(403, "Password and current authenticator code required");
      await c.query(
        "UPDATE users SET mfa_secret=NULL,auth_version=auth_version+1 WHERE id=$1",
        [req.user.id],
      );
      await audit(c, req.user.id, null, "MFA disabled");
    });
    res.clearCookie("session").json({ ok: true });
  }),
);
app.get("/api/license", (req, res) => res.json(validateLicense()));
app.get(
  "/api/bootstrap",
  wrap(async (req, res) => {
    const cfg = await config();
    const organisations = (
      await pool.query(
        "SELECT o.*,p.name package_name,p.targets FROM organisations o JOIN packages p ON p.id=o.package_id" +
          (staff(req.user) ? "" : " WHERE o.id=$1"),
        staff(req.user) ? [] : [req.user.organisation_id],
      )
    ).rows;
    const users = staff(req.user)
      ? (
          await pool.query(
            "SELECT id,name,email,role,organisation_id,active FROM users ORDER BY name",
          )
        ).rows
      : [];
    res.json({
      config: cfg,
      organisations,
      users,
      packages: (await pool.query("SELECT * FROM packages ORDER BY id")).rows,
    });
  }),
);
async function loadTicket(c, id, u, lock = false) {
  const t = (
    await c.query(
      "SELECT * FROM tickets WHERE id=$1" + (lock ? " FOR UPDATE" : ""),
      [id],
    )
  ).rows[0];
  if (!t || (!staff(u) && t.organisation_id !== u.organisation_id))
    throw error(404, "Ticket not found");
  return t;
}
const ticketSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(5).max(20000),
  category: z.string().max(100),
  priority: z.enum(["Critical", "High", "Medium", "Low"]),
  organisation_id: z.coerce.number().int().positive().optional(),
  custom_fields: z.record(z.string().max(2000)).optional(),
});
async function createTicket(c, u, b, source = "portal") {
  const cfg = await config(c);
  if (!cfg.categories.includes(b.category))
    throw error(400, "Invalid category");
  const orgId = staff(u) ? b.organisation_id : u.organisation_id;
  if (!orgId) throw error(400, "Choose an organisation");
  const org = (
    await c.query(
      "SELECT p.targets,p.name FROM organisations o JOIN packages p ON p.id=o.package_id WHERE o.id=$1",
      [orgId],
    )
  ).rows[0];
  if (!org) throw error(400, "Invalid organisation");
  const targets = org.targets[b.priority];
  let assignee = null;
  if (cfg.workflow.assignment !== "manual") {
    const agents = (
      await c.query(
        "SELECT u.id,count(t.id)::int workload FROM users u LEFT JOIN tickets t ON t.assignee_id=u.id AND t.status NOT IN ('Resolved','Closed') WHERE u.active AND u.role='agent' GROUP BY u.id ORDER BY workload,u.id",
      )
    ).rows;
    if (agents.length) {
      if (cfg.workflow.assignment === "round-robin") {
        await c.query("SELECT pg_advisory_xact_lock(882022)");
        const last = (
          await c.query(
            "SELECT assignee_id FROM tickets WHERE assignee_id IS NOT NULL ORDER BY id DESC LIMIT 1",
          )
        ).rows[0];
        agents.sort((a, b) => a.id - b.id);
        assignee =
          agents[
            (agents.findIndex((a) => a.id === last?.assignee_id) + 1) %
              agents.length
          ].id;
      } else assignee = agents[0].id;
    }
  }
  const t = (
    await c.query(
      "INSERT INTO tickets(title,description,organisation_id,creator_id,category,priority,response_minutes,resolution_minutes,calendar,assignee_id,status,source,custom_fields) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
      [
        b.title,
        b.description,
        orgId,
        u.id,
        b.category,
        b.priority,
        targets.response,
        targets.resolution,
        JSON.stringify(cfg.calendar),
        assignee,
        assignee ? "Assigned" : "New",
        source,
        JSON.stringify(b.custom_fields || {}),
      ],
    )
  ).rows[0];
  t.number = `TF-${String(t.id).padStart(6, "0")}`;
  await c.query("UPDATE tickets SET number=$1 WHERE id=$2", [t.number, t.id]);
  await c.query("UPDATE tickets SET package_name=$1 WHERE id=$2", [
    org.name,
    t.id,
  ]);
  await runHook("ticketCreated", {
    client: c,
    ticket: t,
    user: u,
    config: cfg,
  });
  await audit(c, u.id, t.id, "created", { source });
  await notify(c, t, "Ticket created");
  return t;
}
app.get(
  "/api/tickets",
  wrap(async (req, res) => {
    const params = [];
    const where = [];
    if (!staff(req.user)) {
      params.push(req.user.organisation_id);
      where.push(`t.organisation_id=$${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      where.push(`t.status=$${params.length}`);
    }
    if (req.query.search) {
      params.push("%" + String(req.query.search).slice(0, 200) + "%");
      where.push(
        `(t.title ILIKE $${params.length} OR t.number ILIKE $${params.length})`,
      );
    }
    const rows = (
      await pool.query(
        `SELECT t.*,o.name organisation_name,u.name assignee_name FROM tickets t JOIN organisations o ON o.id=t.organisation_id LEFT JOIN users u ON u.id=t.assignee_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY t.created_at DESC LIMIT 500`,
        params,
      )
    ).rows;
    res.json(rows.map((t) => ({ ...t, sla: slaState(t) })));
  }),
);
app.post(
  "/api/tickets",
  wrap(async (req, res) =>
    res
      .status(201)
      .json(
        await tx((c) =>
          createTicket(c, req.user, ticketSchema.parse(req.body)),
        ),
      ),
  ),
);
app.get(
  "/api/tickets/:id",
  wrap(async (req, res) => {
    const t = await loadTicket(pool, req.params.id, req.user);
    const comments = (
      await pool.query(
        "SELECT c.*,u.name author FROM comments c JOIN users u ON u.id=c.user_id WHERE ticket_id=$1" +
          (staff(req.user) ? "" : " AND NOT internal") +
          " ORDER BY c.id",
        [t.id],
      )
    ).rows;
    const history = (
      await pool.query(
        "SELECT a.id,a.action,a.created_at,u.name actor FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE ticket_id=$1 AND action <> 'internal note' ORDER BY a.id",
        [t.id],
      )
    ).rows;
    res.json({
      ...t,
      sla: slaState(t),
      comments,
      history,
      attachments: (
        await pool.query(
          "SELECT id,name,size FROM attachments WHERE ticket_id=$1",
          [t.id],
        )
      ).rows,
      links: (
        await pool.query(
          "SELECT t.id,t.number,t.title FROM ticket_links l JOIN tickets t ON t.id=l.related_id WHERE l.ticket_id=$1 AND t.organisation_id=$2",
          [t.id, t.organisation_id],
        )
      ).rows,
    });
  }),
);
app.patch(
  "/api/tickets/:id",
  wrap(async (req, res) => {
    const b = z
      .object({
        status: z.string().optional(),
        assignee_id: z.number().int().positive().nullable().optional(),
        rating: z.number().int().min(1).max(5).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await tx(async (c) => {
        let t = await loadTicket(c, req.params.id, req.user, true);
        const cfg = await config(c);
        if (b.rating !== undefined) {
          if (staff(req.user) || !["Resolved", "Closed"].includes(t.status))
            throw error(403, "Only clients can rate resolved tickets");
          await c.query("UPDATE tickets SET rating=$1 WHERE id=$2", [
            b.rating,
            t.id,
          ]);
          await audit(c, req.user.id, t.id, "rated", { rating: b.rating });
        }
        if (b.assignee_id !== undefined) {
          if (!manage(req.user))
            throw error(403, "Assignment requires a team lead");
          if (
            b.assignee_id &&
            !(
              await c.query(
                "SELECT 1 FROM users WHERE id=$1 AND active AND role IN ('agent','lead','manager','admin')",
                [b.assignee_id],
              )
            ).rowCount
          )
            throw error(400, "Invalid assignee");
          await c.query("UPDATE tickets SET assignee_id=$1 WHERE id=$2", [
            b.assignee_id,
            t.id,
          ]);
          await audit(c, req.user.id, t.id, "assigned", {
            assignee: b.assignee_id,
          });
        }
        if (b.status) {
          if (!cfg.statuses.includes(b.status))
            throw error(400, "Invalid status");
          const reopen =
            ["Resolved", "Closed"].includes(t.status) &&
            !["Resolved", "Closed"].includes(b.status);
          if (
            !staff(req.user) &&
            !(
              reopen &&
              b.status === "New" &&
              Date.now() - new Date(t.resolved_at).getTime() <=
                cfg.workflow.reopenDays * 86400000
            )
          )
            throw error(
              403,
              "Reopen window expired or transition not permitted",
            );
          if (b.status === "Closed" && t.status !== "Resolved")
            throw error(400, "Resolve the ticket before closing it");
          if (b.status !== t.status) {
            const elapsed = effectiveElapsed(t);
            await c.query(
              "UPDATE tickets SET status=$1,elapsed_minutes=$2,last_tick=now(),updated_at=now(),resolution_elapsed=CASE WHEN $1='Resolved' THEN $2::numeric WHEN $3 THEN NULL ELSE resolution_elapsed END,resolution_breached=CASE WHEN $1='Resolved' THEN $2::numeric>=resolution_minutes ELSE resolution_breached END,resolved_at=CASE WHEN $1='Resolved' THEN now() WHEN $3 THEN NULL ELSE resolved_at END,closed_at=CASE WHEN $1='Closed' THEN now() WHEN $3 THEN NULL ELSE closed_at END WHERE id=$4",
              [b.status, elapsed, reopen, t.id],
            );
            await audit(c, req.user.id, t.id, "status changed", {
              from: t.status,
              to: b.status,
            });
          }
        }
        t = await loadTicket(c, t.id, req.user);
        await notify(c, t, "Ticket updated");
        return t;
      }),
    );
  }),
);
app.post(
  "/api/tickets/:id/comments",
  wrap(async (req, res) => {
    const b = z
      .object({
        body: z.string().trim().min(1).max(20000),
        internal: z.boolean().default(false),
      })
      .parse(req.body);
    res.status(201).json(
      await tx(async (c) => {
        let t = await loadTicket(c, req.params.id, req.user, true);
        if (b.internal && !staff(req.user))
          throw error(403, "Internal notes are staff only");
        if (t.status === "Closed")
          throw error(400, "Reopen the ticket before replying");
        const result = (
          await c.query(
            "INSERT INTO comments(ticket_id,user_id,body,internal) VALUES($1,$2,$3,$4) RETURNING *",
            [t.id, req.user.id, b.body, b.internal],
          )
        ).rows[0];
        if (staff(req.user) && !b.internal && !t.responded_at) {
          await c.query(
            "UPDATE tickets SET responded_at=now(),response_elapsed=$1,response_breached=$1::numeric>=response_minutes,elapsed_minutes=$1,last_tick=now(),warning_sent=false,breach_sent=false WHERE id=$2",
            [effectiveElapsed(t), t.id],
          );
        }
        if (!staff(req.user) && t.status === "Waiting on Client")
          await c.query(
            "UPDATE tickets SET status='In Progress',last_tick=now() WHERE id=$1",
            [t.id],
          );
        await c.query("UPDATE tickets SET updated_at=now() WHERE id=$1", [
          t.id,
        ]);
        await audit(
          c,
          req.user.id,
          t.id,
          b.internal ? "internal note" : "reply",
        );
        if (!b.internal) await notify(c, t, "New reply");
        return result;
      }),
    );
  }),
);
app.post(
  "/api/tickets/:id/links",
  wrap(async (req, res) => {
    if (!staff(req.user)) throw error(403, "Staff only");
    const related = z.coerce
      .number()
      .int()
      .positive()
      .parse(req.body.related_id);
    await tx(async (c) => {
      const a = await loadTicket(c, req.params.id, req.user),
        b = await loadTicket(c, related, req.user);
      if (a.organisation_id !== b.organisation_id)
        throw error(400, "Link tickets within the same organisation");
      await c.query(
        "INSERT INTO ticket_links VALUES($1,$2) ON CONFLICT DO NOTHING",
        [a.id, b.id],
      );
      await c.query(
        "INSERT INTO ticket_links VALUES($1,$2) ON CONFLICT DO NOTHING",
        [b.id, a.id],
      );
      await audit(c, req.user.id, a.id, "linked", { related });
    });
    res.json({ ok: true });
  }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    cb(
      null,
      ["image/png", "image/jpeg", "application/pdf", "text/plain"].includes(
        file.mimetype,
      ),
    ),
});
app.post(
  "/api/tickets/:id/attachments",
  upload.single("file"),
  wrap(async (req, res) => {
    const t = await loadTicket(pool, req.params.id, req.user);
    if (!req.file)
      throw error(400, "Use PNG, JPEG, PDF or text (10 MB maximum)");
    const buf = req.file.buffer,
      m = req.file.mimetype;
    if (
      (m === "application/pdf" && buf.subarray(0, 5).toString() !== "%PDF-") ||
      (m === "image/png" &&
        buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") ||
      (m === "image/jpeg" && buf.subarray(0, 3).toString("hex") !== "ffd8ff") ||
      (m === "text/plain" && buf.includes(0))
    )
      throw error(400, "File content does not match type");
    await scan(buf);
    const dir = path.resolve(process.env.UPLOAD_DIR || "uploads");
    await fs.mkdir(dir, { recursive: true });
    const filename = randomUUID();
    await fs.writeFile(path.join(dir, filename), buf);
    try {
      const a = await tx(async (c) => {
        const a = (
          await c.query(
            "INSERT INTO attachments(ticket_id,name,path,mime,size) VALUES($1,$2,$3,$4,$5) RETURNING id,name,size",
            [
              t.id,
              path.basename(req.file.originalname),
              filename,
              m,
              buf.length,
            ],
          )
        ).rows[0];
        await audit(c, req.user.id, t.id, "attachment added");
        return a;
      });
      res.status(201).json(a);
    } catch (e) {
      await fs.unlink(path.join(dir, filename));
      throw e;
    }
  }),
);
app.get(
  "/api/attachments/:id",
  wrap(async (req, res) => {
    const a = (
      await pool.query("SELECT * FROM attachments WHERE id=$1", [req.params.id])
    ).rows[0];
    if (!a) throw error(404, "Attachment not found");
    await loadTicket(pool, a.ticket_id, req.user);
    res.set("X-Content-Type-Options", "nosniff");
    res.download(
      path.resolve(process.env.UPLOAD_DIR || "uploads", a.path),
      a.name,
    );
  }),
);
app.get(
  "/api/notifications",
  wrap(async (req, res) =>
    res.json(
      (
        await pool.query(
          "SELECT * FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 100",
          [req.user.id],
        )
      ).rows,
    ),
  ),
);
app.post(
  "/api/notifications/read",
  wrap(async (req, res) => {
    await pool.query(
      "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL",
      [req.user.id],
    );
    res.json({ ok: true });
  }),
);
app.put(
  "/api/admin/settings/:key",
  admin,
  wrap(async (req, res) => {
    const key = req.params.key,
      v = req.body.value;
    const schemas = {
      branding: z.object({
        name: z.string().min(1).max(80),
        colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
      categories: z.array(z.string().min(1).max(100)).min(1),
      statuses: z
        .array(z.string())
        .refine((a) =>
          [
            "New",
            "Assigned",
            "In Progress",
            "Waiting on Client",
            "Resolved",
            "Closed",
          ].every((s) => a.includes(s)),
        ),
      calendar: z
        .object({
          timezone: z.string().refine((s) => {
            try {
              new Intl.DateTimeFormat("en", { timeZone: s });
              return true;
            } catch {
              return false;
            }
          }),
          days: z.array(z.number().int().min(1).max(7)).min(1),
          start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
        })
        .refine((o) => o.end > o.start),
      workflow: z.object({
        reopenDays: z.number().int().min(0).max(365),
        autoCloseDays: z.number().int().min(1).max(365),
        assignment: z.enum(["manual", "workload", "round-robin"]),
        warningThreshold: z.number().min(0.1).max(0.99),
      }),
      templates: z.array(z.string().max(10000)),
      modules: z.record(z.boolean()),
      articles: z.array(z.object({ title: z.string(), body: z.string() })),
      customFields: z.array(
        z.object({ name: z.string().min(1), label: z.string().min(1) }),
      ),
    };
    if (!schemas[key]) throw error(400, "Unknown setting");
    const val = schemas[key].parse(v);
    if (key === "modules") {
      const license = validateLicense();
      if (
        license.mode === "licensed" &&
        Object.entries(val).some(([k, v]) => v && !license.modules.includes(k))
      )
        throw error(403, "Module not licensed");
    }
    await tx(async (c) => {
      await c.query(
        "INSERT INTO settings VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
        [key, JSON.stringify(val)],
      );
      await audit(c, req.user.id, null, "configuration changed", { key });
    });
    res.json({ ok: true });
  }),
);
app.post(
  "/api/admin/packages",
  admin,
  wrap(async (req, res) => {
    const b = z
      .object({
        name: z.string().min(1).max(80),
        targets: z.object(
          Object.fromEntries(
            ["Critical", "High", "Medium", "Low"].map((p) => [
              p,
              z
                .object({
                  response: z.number().int().positive(),
                  resolution: z.number().int().positive(),
                })
                .refine((t) => t.resolution >= t.response),
            ]),
          ),
        ),
      })
      .parse(req.body);
    res.json(
      await tx(async (c) => {
        const r = await c.query(
          "INSERT INTO packages(name,targets) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET targets=EXCLUDED.targets RETURNING *",
          [b.name, JSON.stringify(b.targets)],
        );
        await audit(c, req.user.id, null, "package saved", { name: b.name });
        return r.rows[0];
      }),
    );
  }),
);
app.post(
  "/api/admin/organisations",
  admin,
  wrap(async (req, res) => {
    const b = z
      .object({
        name: z.string().min(1).max(100),
        package_id: z.number().int().positive(),
      })
      .parse(req.body);
    res.json(
      await tx(async (c) => {
        const r = await c.query(
          "INSERT INTO organisations(name,package_id) VALUES($1,$2) RETURNING *",
          [b.name, b.package_id],
        );
        await audit(c, req.user.id, null, "organisation created", {
          id: r.rows[0].id,
        });
        return r.rows[0];
      }),
    );
  }),
);
app.patch(
  "/api/admin/organisations/:id",
  admin,
  wrap(async (req, res) => {
    const b = z
      .object({ package_id: z.number().int().positive() })
      .parse(req.body);
    await tx(async (c) => {
      await c.query("UPDATE organisations SET package_id=$1 WHERE id=$2", [
        b.package_id,
        req.params.id,
      ]);
      await audit(c, req.user.id, null, "organisation package changed", {
        id: req.params.id,
      });
    });
    res.json({ ok: true });
  }),
);
app.post(
  "/api/admin/users",
  admin,
  wrap(async (req, res) => {
    const b = z
      .object({
        name: z.string().min(1).max(100),
        email: z.string().email(),
        password: z.string().min(12).max(200),
        role: z.enum(["client", "agent", "lead", "manager", "admin", "owner"]),
        organisation_id: z.number().int().positive().nullable(),
      })
      .parse(req.body);
    if (b.role === "client" && !b.organisation_id)
      throw error(400, "Clients require an organisation");
    await tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(882024)");
      const licence = validateLicense();
      if (
        Number(
          (await c.query("SELECT count(*) n FROM users WHERE active")).rows[0]
            .n,
        ) >= licence.maxUsers
      )
        throw error(403, "Licence user limit reached");
      const r = await c.query(
        "INSERT INTO users(name,email,password,role,organisation_id) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [
          b.name,
          b.email.toLowerCase(),
          await bcrypt.hash(b.password, 12),
          b.role,
          b.organisation_id,
        ],
      );
      await audit(c, req.user.id, null, "user created", { id: r.rows[0].id });
    });
    res.status(201).json({ ok: true });
  }),
);
app.patch(
  "/api/admin/users/:id",
  admin,
  wrap(async (req, res) => {
    const b = z
      .object({
        active: z.boolean().optional(),
        password: z.string().min(12).max(200).optional(),
      })
      .parse(req.body);
    if (Number(req.params.id) === req.user.id && b.active === false)
      throw error(400, "Cannot deactivate yourself");
    await tx(async (c) => {
      if (b.active === true) {
        await c.query("SELECT pg_advisory_xact_lock(882024)");
        const licence = validateLicense();
        const target = (
          await c.query("SELECT active FROM users WHERE id=$1", [req.params.id])
        ).rows[0];
        if (
          target &&
          !target.active &&
          Number(
            (await c.query("SELECT count(*) n FROM users WHERE active")).rows[0]
              .n,
          ) >= licence.maxUsers
        )
          throw error(403, "Licence user limit reached");
      }
      if (b.active !== undefined)
        await c.query(
          "UPDATE users SET active=$1,auth_version=auth_version+1 WHERE id=$2",
          [b.active, req.params.id],
        );
      if (b.password)
        await c.query(
          "UPDATE users SET password=$1,auth_version=auth_version+1 WHERE id=$2",
          [await bcrypt.hash(b.password, 12), req.params.id],
        );
      await audit(c, req.user.id, null, "user updated", { id: req.params.id });
    });
    res.json({ ok: true });
  }),
);
app.get(
  "/api/reports",
  wrap(async (req, res) => {
    if (!staff(req.user)) throw error(403, "Staff only");
    const rows = (
      await pool.query(
        `SELECT t.*,o.name organisation,COALESCE(t.package_name,p.name) package,u.name agent,EXTRACT(EPOCH FROM(t.responded_at-t.created_at))/60 response_wall_minutes,EXTRACT(EPOCH FROM(t.resolved_at-t.created_at))/60 resolution_wall_minutes FROM tickets t JOIN organisations o ON o.id=t.organisation_id JOIN packages p ON p.id=o.package_id LEFT JOIN users u ON u.id=t.assignee_id ORDER BY t.created_at DESC`,
      )
    ).rows;
    res.json(rows.map((t) => ({ ...t, sla: slaState(t) })));
  }),
);
app.get(
  "/api/admin/audit",
  admin,
  wrap(async (req, res) =>
    res.json(
      (
        await pool.query(
          "SELECT a.*,u.name actor FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500",
        )
      ).rows,
    ),
  ),
);
app.use("/api", (req, res) =>
  res.status(404).json({ error: "API route not found" }),
);
app.use(
  express.static(new URL("../../client/dist/", import.meta.url).pathname),
);
app.get("*", (req, res) =>
  res.sendFile(
    new URL("../../client/dist/index.html", import.meta.url).pathname,
  ),
);
app.use((err, req, res, next) => {
  if (err instanceof z.ZodError)
    return res.status(400).json({
      error: err.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
  console.error(err.message);
  res
    .status(
      err.status ||
        (err.code === "23505"
          ? 409
          : err.code === "23503" || err.code === "23514"
            ? 400
            : err instanceof multer.MulterError
              ? 400
              : 500),
    )
    .json({
      error: err.status
        ? err.message
        : err.code === "23505"
          ? "Record already exists"
          : err.code === "23503"
            ? "Invalid referenced record"
            : err instanceof multer.MulterError
              ? err.message
              : "Request failed",
    });
});
