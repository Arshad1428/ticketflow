#!/usr/bin/env bash
set -euo pipefail
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/database-$stamp.dump"
# Include attachments. This requires the local app image to have been built.
docker compose run --rm --no-deps --entrypoint tar app -czf - -C /app/uploads . > "backups/attachments-$stamp.tar.gz"
printf 'Backup saved: %s\n' "$stamp"
