# Deploy on exe.dev + Cloudflare

```
Visitors ─HTTPS─▶ Cloudflare edge (DNS, TLS, WAF, cache) ──Tunnel──▶ exe.dev VM: cloudflared ─▶ web ─▶ api ─▶ db (Postgres 16)
                                                                                 worker ×2 ─▶ db
                                                                                 worker ×2, api ─▶ R2 (replays)
                                                                    backup.sh (nightly) ─▶ R2 (database dumps)
```

- **VM:** one exe.dev VM (`exeuntu` image, Docker) running `deploy/exe/compose.yml`, using images `ghcr.io/onomasticon/autosoccer` and `…/autosoccer-web` tagged with the git commit SHA. The whole stack fits the personal plan's smallest capacity (2 vCPU / 4 GB / 100 GB, $15/month).
- **Postgres:** PostgreSQL 16 in the stack, on the VM's disk. exe.dev has no managed database. Its disks are local NVMe whose changes are streamed to other machines in the region, and `backup.sh` adds nightly dumps to R2 that don't depend on exe.dev at all.
- **Replays:** Cloudflare R2 (`REPLAY_STORE=r2`). Replays are immutable, and both R2 and the site serve them with a one-year cache header.
- **Ingress:** Cloudflare Tunnel. `cloudflared` dials out, so no port is published and the VM's exe.dev HTTPS proxy stays private.

### Why a Tunnel instead of exe.dev's custom domains
exe.dev can serve a custom domain itself (a CNAME to `<vm>.exe.xyz` plus `ssh exe.dev domain add`), but only with Cloudflare's proxy off ("DNS only"). Cloudflare's proxy replaces the CNAME target and breaks exe.dev's routing. Without the proxy there is no edge cache or WAF in front of the site. The Tunnel keeps both and needs nothing from exe.dev except outbound internet, which VMs have by default (egress policy `all`).

## One-time setup

### exe.dev
1. **Account and region.** Pick the region closest to your players (`ssh exe.dev set-region <region>`; e.g. `lax`, `nyc`, `lon`, `fra`). New VMs are created there.
2. **VM.** Create a VM named e.g. `autosoccer` from the default `exeuntu` image, and give it the full 2 vCPU / 4 GB if it shares the capacity with other VMs.
3. **Docker.** `ssh autosoccer.exe.xyz`, then check `docker run --rm alpine:latest echo hello` and `docker compose version`. If the Compose plugin is missing, install `docker-compose-plugin`.
4. **Files in `~/autosoccer`.**
   - Copy `deploy/exe/compose.yml`, `deploy/exe/deploy.sh` and `deploy/exe/backup.sh` there. The deploy job re-copies them on every run.
   - Fill in `.env` from `deploy/exe/env.example`, then `chmod 600 .env`. Generate the database password with `openssl rand -hex 24`.
5. **Deploy key.** Create a key pair for GitHub Actions and limit it to this VM:
   ```sh
   ssh-keygen -t ed25519 -N '' -C autosoccer-deploy -f deploy_key
   cat deploy_key.pub | ssh exe.dev ssh-key add --vm=autosoccer
   ssh -i deploy_key vm+autosoccer@vm.exe.xyz true    # accept the host key once
   ssh-keygen -F vm.exe.xyz                          # this line is DEPLOY_KNOWN_HOSTS
   ```
   The `vm+<name>@vm.exe.xyz` form is the destination exe.dev documents as always working; `<name>.exe.xyz` is the convenient one.
6. **Backups.** Add the cron line from the top of `backup.sh` (`crontab -e`; install `cron` if the image lacks it). Then run `./backup.sh` once by hand and check the dump appears in the bucket.

### Cloudflare
1. **Domain.** Add the site's domain to Cloudflare and set SSL/TLS to *Full*.
2. **Tunnel.** Under Zero Trust → Networks → Tunnels, create a tunnel.
   - Copy its token into `TUNNEL_TOKEN`.
   - Add a public hostname, e.g. `autosoccer.example.com`, with service `http://web:3000`.
3. **R2.**
   - Create two private buckets: `autosoccer-replays` and `autosoccer-backups`. The site serves replays through `web`.
   - On `autosoccer-backups`, add a lifecycle rule that deletes objects under `db/` after 30 days.
   - Create an R2 API token with *Object Read & Write* on both buckets. Put its key, secret and the account's S3 endpoint into the `R2_*` settings.
4. **Cache rule.** Cloudflare doesn't cache HTML unless a rule allows it. Under Caching → Cache Rules, create a rule:
   - **Match:** hostname equals your site, and URI path does not start with `/search`.
   - **Then:** *Eligible for cache*, with Edge TTL set to *Use cache-control header if present*.

   The app sends these headers:

   | Response | `Cache-Control` |
   | --- | --- |
   | Pages | `public, max-age=0, s-maxage=60, stale-while-revalidate=300` |
   | Replays | `public, max-age=31536000, immutable` |
   | Search | `private, no-store` |
   | Any 4xx or 5xx | `private, no-store` |

### GitHub
- **GHCR access for the VM.** Either make both container packages public, or run `docker login ghcr.io` on the VM with a token that has `read:packages`.
- **Production environment.** Create an environment named `production` with these secrets:

  | Secret | Value |
  | --- | --- |
  | `DEPLOY_VM` | The VM's name, e.g. `autosoccer` |
  | `DEPLOY_SSH_KEY` | The private half of the VM-scoped deploy key (`deploy_key`) |
  | `DEPLOY_KNOWN_HOSTS` | The `ssh-keygen -F vm.exe.xyz` line from step 5 |

- **Deploy workflow.** Every push to `main` runs CI, and once validation passes its `deploy` job calls `.github/workflows/deploy.yml`, which builds and pushes both images. It copies `compose.yml`, `deploy.sh` and `backup.sh` to `~/autosoccer` on the VM over SSH, then runs `./deploy.sh <sha>`. It can also be started by hand, with an optional commit.

## Deploying
```sh
# on the VM (the CI job does exactly this)
cd ~/autosoccer
./deploy.sh <git-sha>     # pull missing images → database up → migrate → start → wait for health checks
./deploy.sh --rollback    # back to the previously deployed tag
```
`deploy.sh` refuses to run without `.env` or with a weak or non-URL-safe `POSTGRES_PASSWORD`, and only accepts tags made of `[A-Za-z0-9._-]`. Migrations take an advisory lock, are checksummed, and run once per deploy, before the new version starts. A rollback doesn't undo migrations, so keep them backward compatible.

The Compose project is named `autosoccer-exe`. `deploy.sh` runs `up --remove-orphans`, which removes any container in the same project that the file doesn't define, so never reuse that name for anything else on the VM. The database lives in the `autosoccer-exe_pgdata` volume. `docker compose down` keeps it, but `down -v` deletes it.

## Backups and restore
- **Nightly dumps.** `backup.sh` streams a `pg_dump -Fc` to `R2_BACKUP_BUCKET/db/<UTC time>.dump`, and the lifecycle rule keeps 30 days of them.
- **VM snapshots (optional).** exe.dev can also snapshot the whole disk to an S3 bucket (`backup new --bucket=… --integration=… autosoccer`). These are incremental, and `--freeze` pauses writes for a consistent copy. See exe.dev's VM backup docs.

To restore a dump:
```sh
cd ~/autosoccer
set -a; source .env; set +a; export IMAGE_TAG="$(cat .deployed-tag)"
docker run --rm -v "$PWD:/out" -e AWS_DEFAULT_REGION=auto \
  -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  amazon/aws-cli:2.22.35 s3 cp "s3://$R2_BACKUP_BUCKET/db/<time>.dump" /out/restore.dump --endpoint-url "$R2_ENDPOINT"
docker compose -f compose.yml stop api worker web
docker compose -f compose.yml exec -T db pg_restore -U autosoccer -d autosoccer --clean --if-exists < restore.dump
./deploy.sh "$IMAGE_TAG"
```

## Starting a season
```sh
docker compose -f compose.yml exec api bun scripts/league.ts seed --budget 1.00 --editorial-budget 3.00 --interval 10080   # weekly rounds
```
After that the workers run everything. Monitoring and failure handling are the same as in [runbook.md](runbook.md):
```sh
docker compose -f compose.yml exec api bun run ops status
docker compose -f compose.yml logs -f --since 10m worker
```
## Local rehearsal
`SKIP_TUNNEL=1 ./deploy.sh <tag>` runs the stack without connecting `cloudflared`; `TUNNEL_TOKEN` still needs a placeholder value. To rehearse:
- tag locally built images as `ghcr.io/onomasticon/autosoccer{,-web}:<tag>`;
- point `R2_*` at any S3-compatible endpoint.

Run it from a directory other than the repo, so it can't collide with the dev stack.
