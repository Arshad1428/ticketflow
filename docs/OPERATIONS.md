# Install, upgrade, backup and recovery

## Install

Use the README quick start for a dedicated database-per-customer installation. Root .env configures Compose. Development runs use server/.env. Environment files and private licence keys are excluded from Git and Docker builds.

## Upgrade

1. Back up database and files with `bash scripts/backup.sh`.
2. Restore the backup to a test installation and verify the new release against it.
3. Stop app writes during a production upgrade. Replace source with the new version, preserve .env and volumes, then run `docker compose up --build -d`.
4. Startup runs versioned migrations before serving traffic. Inspect app logs and GET /api/health.
5. If rollback is necessary, stop the app and restore the matching database and upload backup with the old app version. Never assume an old binary supports a migrated schema.

## Backup / restore

```bash
bash scripts/backup.sh
bash scripts/restore.sh backups/database-TIMESTAMP.dump backups/attachments-TIMESTAMP.tar.gz
```

Backup contains personal/support data. Encrypt backup destinations, restrict access, copy off the host and test restoration regularly. For a consistent database/file snapshot, stop app writes while backing up; the basic backup script does not coordinate an online atomic snapshot. Restore requires explicit typed confirmation and replaces data. Do not restore untrusted SQL/archive files.

## External services

- SMTP: set host/port/security/credentials and EMAIL_FROM. TLS behavior is delegated to the mail server; set SMTP_SECURE=true for implicit TLS on port 465, or use STARTTLS on 587.
- Inbound email: connect your provider adapter to the authenticated webhook. Verify provider signatures and sender authentication before normalizing messages. A shared secret alone does not prove a mail's original sender.
- Antivirus: enable the scanner Compose profile and fail-closed upload scanning. ClamAV downloads definitions, which may take several minutes. Maintain updates.
- HTTPS: use a reverse proxy/TLS certificate; set NODE_ENV=production and exact APP_ORIGIN. Configure trusted-proxy handling deliberately if using forwarded IP addresses and rate limits behind your proxy.

## Monitoring

Monitor `/api/health`, container restart counts, worker errors, unsent outbox age, backup success and disk usage. Alerts to leads/managers are in-app plus queued mail. No external monitoring service is provisioned. Restarting the application retains SLA elapsed time, audit history and notification jobs.

## Known operational limits

SLA tick precision is 30 seconds. The dashboard polls every 30 seconds. Large ticket lists currently cap at 500 and reports retrieve all ticket rows; add pagination and reporting indexes before large-volume deployments. Long-running mail delivery currently holds queue transactions, so keep SMTP timeouts/server behavior controlled. Password changes and activation changes invalidate existing sessions through an account version counter. Logout clears the current cookie; it does not revoke a stolen copy by itself. TOTP MFA is supported, but recovery codes and lost-device recovery are not supplied. Implement retention and translations before deployments requiring those features.
