# Validation performed

- React/Vite production build: passed.
- Node test suite: 9 tests passed, 0 failed.
- PostgreSQL-compatible integration: actual SQL migrations and Express endpoints run against PGlite.
- Lifecycle coverage: creation, automatic assignment, notes and replies, response accounting, waiting/resume, attachments, resolution, rating and reopening.
- Security coverage: organisation isolation, staff/admin permission checks, origin rejection, immutable audit, encrypted TOTP enrollment/login and account-version session invalidation.
- SLA coverage: partial business minutes, nights/weekends, holidays, time zones, daylight saving transition, pauses and worker deduplication.
- Signed licence validation: correct signature, installation binding and tamper rejection.
- Production dependency audit: zero reported vulnerabilities at packaging time.

Not performed in this environment: Docker/PostgreSQL 16 container startup (Docker unavailable), real SMTP delivery, live mail-provider integration, ClamAV service integration, external HTTPS deployment, browser interaction/accessibility audit or performance/load testing. The README and operations guide explain how to configure these on the target installation.
