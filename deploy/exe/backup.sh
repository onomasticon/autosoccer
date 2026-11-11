#!/usr/bin/env bash
# Dumps the database (pg_dump custom format) and uploads it to R2_BACKUP_BUCKET/db/<UTC time>.dump.
# Run nightly from cron on the VM:
#   15 3 * * * $HOME/autosoccer/backup.sh >> $HOME/autosoccer/backup.log 2>&1
# Restore: docs/operations/deploy-cloudflare-exe.md#backups-and-restore
set -euo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] || { echo ".env missing" >&2; exit 1; }
set -a; source .env; set +a
: "${R2_ENDPOINT:?}" "${R2_BACKUP_BUCKET:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"

key="db/$(date -u +%Y%m%dT%H%M%SZ).dump"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# IMAGE_TAG only satisfies interpolation; exec reuses the running db container.
IMAGE_TAG="$(cat .deployed-tag 2>/dev/null || echo none)" \
  docker compose -f compose.yml exec -T db pg_dump -U autosoccer -d autosoccer -Fc > "$tmp"
[[ -s "$tmp" ]] || { echo "empty dump" >&2; exit 1; }

# aws-cli 2.22 predates the default CRC request checksums that S3-compatible stores may reject.
docker run --rm -v "$tmp:/dump:ro" \
  -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  -e AWS_DEFAULT_REGION=auto \
  amazon/aws-cli:2.22.35 s3 cp /dump "s3://$R2_BACKUP_BUCKET/$key" --endpoint-url "$R2_ENDPOINT" --only-show-errors
echo "✓ $(date -u +%FT%TZ) backed up $(du -h "$tmp" | cut -f1) to $R2_BACKUP_BUCKET/$key"
