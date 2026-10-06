import { pool, tx } from "./db.js";
import { config, audit, notify } from "./app.js";
import { effectiveElapsed } from "./sla.js";
import nodemailer from "nodemailer";
export async function tick() {
  await tx(async (c) => {
    const lock = (
      await c.query("SELECT pg_try_advisory_xact_lock(882023) acquired")
    ).rows[0];
    if (!lock.acquired) return;
    const cfg = await config(c);
    const tickets = (
      await c.query("SELECT * FROM tickets WHERE status <> 'Closed' FOR UPDATE")
    ).rows;
    for (const t of tickets) {
      if (t.status === "Resolved") {
        if (
          Date.now() - new Date(t.updated_at).getTime() >
          cfg.workflow.autoCloseDays * 86400000
        ) {
          await c.query(
            "UPDATE tickets SET status='Closed',closed_at=now() WHERE id=$1",
            [t.id],
          );
          await audit(c, null, t.id, "auto closed");
          await notify(c, t, "Ticket closed");
        }
        continue;
      }
      if (t.status === "Waiting on Client") continue;
      const elapsed = effectiveElapsed(t);
      const target = Math.min(
        t.responded_at ? Infinity : t.response_minutes,
        t.resolution_minutes,
      );
      await c.query(
        "UPDATE tickets SET elapsed_minutes=$1,last_tick=now() WHERE id=$2",
        [elapsed, t.id],
      );
      if (elapsed >= target && !t.breach_sent) {
        await c.query(
          "UPDATE tickets SET breach_sent=true,response_breached=CASE WHEN responded_at IS NULL THEN true ELSE response_breached END,resolution_breached=CASE WHEN elapsed_minutes>=resolution_minutes THEN true ELSE resolution_breached END WHERE id=$1",
          [t.id],
        );
        await audit(c, null, t.id, "SLA breached");
        await notify(c, t, "SLA breached — escalated to management");
      } else if (
        elapsed < target &&
        elapsed >= target * cfg.workflow.warningThreshold &&
        !t.warning_sent
      ) {
        await c.query("UPDATE tickets SET warning_sent=true WHERE id=$1", [
          t.id,
        ]);
        await audit(c, null, t.id, "SLA warning");
        await notify(c, t, "SLA warning — escalated to team lead");
      }
    }
  });
  if (!process.env.SMTP_HOST) return;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  await tx(async (c) => {
    const rows = (
      await c.query(
        "SELECT * FROM outbox WHERE sent_at IS NULL AND next_attempt<=now() ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED",
      )
    ).rows;
    for (const m of rows) {
      try {
        await transport.sendMail({
          from: process.env.EMAIL_FROM,
          to: m.email,
          subject: m.subject,
          text: m.body,
        });
        await c.query("UPDATE outbox SET sent_at=now() WHERE id=$1", [m.id]);
      } catch (e) {
        await c.query(
          "UPDATE outbox SET attempts=attempts+1,next_attempt=now()+interval '5 minutes' WHERE id=$1",
          [m.id],
        );
        console.error("Email delivery deferred:", m.id);
      }
    }
  });
}
