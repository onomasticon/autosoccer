#!/usr/bin/env bash
# Deploys one image tag on the exe.dev VM: pull → database up → migrate → start → wait for health.
#
#   ./deploy.sh <tag>          deploy (CI passes the git sha)
#   ./deploy.sh --rollback     redeploy the previous tag
#
# Lives in ~/autosoccer next to compose.yml and .env.
# SKIP_TUNNEL=1 leaves cloudflared out (local rehearsals without a tunnel token).
set -euo pipefail
cd "$(dirname "$0")"

current="$(cat .deployed-tag 2>/dev/null || true)"
if [[ "${1:-}" == "--rollback" ]]; then
  tag="$(cat .previous-tag 2>/dev/null || true)"
  [[ -n "$tag" ]] || { echo "no previous tag recorded" >&2; exit 1; }
else
  tag="${1:?usage: deploy.sh <image-tag> | --rollback}"
fi
[[ "$tag" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid tag: $tag" >&2; exit 1; }
[[ -f .env ]] || { echo ".env missing (copy env.example)" >&2; exit 1; }
grep -Eq '^POSTGRES_PASSWORD=[A-Za-z0-9]{16,}$' .env ||
  { echo "POSTGRES_PASSWORD in .env must be 16+ letters/digits (openssl rand -hex 24)" >&2; exit 1; }

export IMAGE_TAG="$tag"
compose() { docker compose -f compose.yml "$@"; }
services=(db api worker web)
[[ "${SKIP_TUNNEL:-}" == "1" ]] || services+=(cloudflared)

# A full disk crashes Postgres (2026-11-28: checkpoint PANICs, crash recovery). Refuse to pull into one.
free_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
if (( free_kb < 4 * 1024 * 1024 )); then
  echo "only $((free_kb / 1024)) MB free on /: not pulling. Free space first (old images: see the deploy doc)." >&2
  exit 1
fi

# Tags are commit SHAs, so an image already present is the right one: pull only what's missing.
for image in "ghcr.io/onomasticon/autosoccer:$tag" "ghcr.io/onomasticon/autosoccer-web:$tag"; do
  docker image inspect "$image" >/dev/null 2>&1 || { echo "→ pulling $image"; docker pull --quiet "$image"; }
done
echo "→ database"
compose up -d --wait --wait-timeout 120 db
echo "→ migrating"
compose run --rm migrate
echo "→ starting ${services[*]}"
compose up -d --remove-orphans --wait --wait-timeout 180 "${services[@]}"
compose ps

if [[ -n "$current" && "$current" != "$tag" ]]; then echo "$current" > .previous-tag; fi
echo "$tag" > .deployed-tag
# Keep only this deploy's images and the previous one's (for --rollback); every deploy adds ~0.8 GB.
keep="$tag${current:+|$current}"
docker images --format '{{.Repository}}:{{.Tag}}' |
  grep -E '^ghcr\.io/onomasticon/autosoccer(-web)?:' | grep -Ev ":($keep)$" |
  xargs -r docker rmi >/dev/null 2>&1 || true
docker image prune -f >/dev/null
echo "✓ deployed $tag${current:+ (was $current)}"
