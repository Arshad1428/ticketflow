# TicketFlow — Client Ticketing & SLA Management

React + Express + Node.js + **PostgreSQL**, built from the supplied BRD. No MongoDB.

A runnable Phase 1 implementation with selected Phase 2 features. See `docs/REQUIREMENTS.md` for the exact delivery boundary; this is not a claim that all commercial and nonfunctional requirements have been certified.

## Quick start — Docker Desktop (Windows + Git Bash)

Install Docker Desktop and enable Linux containers. Extract the ZIP, open its `ticketflow` folder in VS Code, then run in Git Bash:

```bash
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, JWT_SECRET, SEED_PASSWORD and EMAIL_WEBHOOK_SECRET.
# Generate random secrets with: openssl rand -hex 32
docker compose up --build -d
```

Open **http://localhost:4000**. Database migrations and demo account creation run automatically. First build needs internet access to download images and npm packages.

All seed accounts use the `SEED_PASSWORD` you set:

| Role                               | Email               |
| ---------------------------------- | ------------------- |
| Administrator                      | admin@example.com   |
| Manager                            | manager@example.com |
| Team lead                          | lead@example.com    |
| Support agent                      | agent@example.com   |
| Acme client                        | client@example.com  |
| Northstar client (isolation check) | other@example.com   |

Seed is idempotent: changing SEED_PASSWORD after initialization does **not** change existing passwords. Admins can reset passwords using the documented API. Replace/delete demo identities before real use. The database starts with no tickets; create a request as a client to exercise the complete workflow.

```bash
docker compose logs -f app
docker compose down               # preserves database and attachments
```

Do not use `docker compose down -v` unless you intend to delete all persistent data.

## Local development — Node.js + PostgreSQL

Use Node.js 22 or newer, npm, and PostgreSQL 16. Python and virtual environments are not used for this stack.

```bash
cp .env.example .env
# Set secrets. DATABASE_URL must match your database credentials.
# You can start only PostgreSQL with Docker:
docker compose up -d db
npm ci
cp .env server/.env
npm run migrate
npm run seed
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to Express on port 4000. After editing root `.env`, copy it again to `server/.env` and restart the server. If using your own PostgreSQL installation, create the database/user matching DATABASE_URL instead of starting the db container. Use URL-safe passwords in the Docker connection URL, or percent-encode special characters for a manually configured URL.

## Validation

```bash
npm test
npm run build
```

Tests cover business calendars, DST, holidays, pause/resume, signed licensing, ticket creation, first response, client isolation, private notes, attachments, assignment permissions, reopening, ratings, immutable audit, MFA and session revocation, inbound email deduplication, and worker escalation deduplication. Integration tests use PGlite (embedded PostgreSQL) with the actual migrations and Express routes. A containerized PostgreSQL smoke test and load testing are still required before production rollout.

## Walkthrough

1. Sign in as `client@example.com`, create a ticket, then attach a file.
2. Sign in as the agent. Read the request, add a private note, then a public reply. Only a public staff reply meets the first-response target.
3. Set **Waiting on Client** to pause the SLA. A client reply resumes **In Progress**.
4. Resolve the ticket. The client can rate it or reopen within the configured window.
5. Sign in as admin to manage users, organisations, packages and configuration. Managers can assign tickets and inspect reports.
6. Use the Security page to change your password or enroll a TOTP authenticator. Password and MFA changes invalidate existing sessions.
7. Review risk alerts, in-app notifications and reports. The background worker runs every 30 seconds.

Targets are in **business minutes**, not wall-clock minutes. The default calendar is 09:00–18:00 Monday–Friday in Asia/Kolkata. Tickets capture their calendar, package name and SLA targets at creation. Existing ticket commitments do not change when configuration changes. Reports label wall-clock averages explicitly; completed SLA compliance uses historical business-time outcomes.

## Email integration

Outbound mail uses SMTP and a durable PostgreSQL outbox. Without SMTP configuration, messages remain queued; the app and in-app notifications keep working. SMTP failures retry every five minutes. Delivery is at least once; a crash after sending can duplicate an email.

Inbound email is a provider-neutral authenticated webhook. Configure your mail provider or a small IMAP adapter to forward normalized messages to `/api/integrations/email`. Verify the provider's original signature in that adapter. Only known client senders are accepted; message IDs deduplicate retries. It creates new tickets; reply threading and inbound email attachments are not included.

```bash
curl -X POST http://localhost:4000/api/integrations/email \
  -H 'Content-Type: application/json' \
  -H "x-webhook-secret: YOUR_EMAIL_WEBHOOK_SECRET" \
  -d '{"messageId":"unique-mail-id-001","from":"client@example.com","subject":"Cannot access portal","text":"Please investigate our access issue."}'
```

## Production installation

The bundled Compose file is intentionally a **localhost HTTP demo**. For production, place Express behind an HTTPS reverse proxy, set `NODE_ENV=production` and `APP_ORIGIN=https://your-domain`, remove the localhost environment overrides in Compose, and expose the application only through that proxy. Secure cookies require HTTPS. Set unique credentials, configure SMTP, backups, network controls, encrypted storage volumes, and the antivirus scanner. Do not expose PostgreSQL publicly.

To enable ClamAV, set `CLAMAV_HOST=scanner`, `UPLOAD_SCAN_REQUIRED=true`, and start `docker compose --profile scanner up --build -d`. Wait for virus definitions to load. Uploads fail closed if a required scanner is unavailable. Development permits unscanned uploads when explicitly configured with `UPLOAD_SCAN_REQUIRED=false`.

See `docs/OPERATIONS.md`, `docs/API.md`, `docs/EXTENSIONS.md` and `docs/REQUIREMENTS.md` for installation boundaries, backups, licensing and remaining hardening work.

## Structure

```text
ticketflow/
  client/src/        React portal, staff workspace and administration
  server/src/        Express API, business-time SLA, mail worker, licensing, scanning
  server/migrations/ Versioned PostgreSQL migrations
  server/tests/      Unit and database-backed integration tests
  scripts/           Backup, restore and licence issuance
  docs/              API, architecture, operations and BRD coverage
  compose.yaml       Dedicated installation with persistent volumes
  Dockerfile         React build + Node runtime
  .env.example       Environment template
```
