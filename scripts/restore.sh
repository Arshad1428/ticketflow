#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 2 ]; then printf 'Usage: bash scripts/restore.sh database.dump attachments.tar.gz\n'; exit 1; fi
read -r -p 'This replaces existing installation data. Type RESTORE: ' answer
[ "$answer" = RESTORE ] || exit 1
docker compose stop app
docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$1"
docker compose run --rm --no-deps --entrypoint sh app -c 'find /app/uploads -type f -delete; tar -xzf - -C /app/uploads' < "$2"
docker compose start app
