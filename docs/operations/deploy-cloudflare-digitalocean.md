# Deploy on DigitalOcean + Cloudflare

```
Visitors ─HTTPS─▶ Cloudflare edge (DNS, TLS, WAF, cache) ──Tunnel──▶ Droplet: cloudflared ─▶ web ─▶ api ─▶ Managed Postgres
                                                                              worker ×2 ─▶ Managed Postgres (direct)
                                                                              worker ×2 ─▶ R2 (replays)   api ─▶ R2
```

- **Droplet:** runs `deploy/droplet/compose.yml`, using images `ghcr.io/onomasticon/autosoccer` and `…/autosoccer-web` tagged with the git commit SHA. It holds no state and publishes no ports.
- **Postgres:** DigitalOcean Managed PostgreSQL 16. Connections use the direct port with verified TLS.
- **Replays:** Cloudflare R2 (`REPLAY_STORE=r2`). Replays are immutable, and both R2 and the site serve them with a one-year cache header.
- **Ingress:** Cloudflare Tunnel. `cloudflared` dials out, so the Droplet firewall only needs SSH.

## One-time setup

### DigitalOcean
1. **Database.** Create a PostgreSQL 16 cluster and a database named `autosoccer`. Under *Trusted sources*, add the Droplet. Download the CA certificate.
2. **Droplet.** Ubuntu 24.04 with Docker; the Docker 1-Click image works. 2 vCPU / 4 GB, in the same region and VPC as the database.
   - Firewall: inbound SSH only.
   - Create a `deploy` user in the `docker` group, with `/opt/autosoccer` owned by `deploy`.
3. **Files in `/opt/autosoccer`.**
   - Copy `deploy/droplet/compose.yml` and `deploy/droplet/deploy.sh` there. The deploy job re-copies both on every run.
   - Save the CA certificate as `ca-certificate.crt`.
   - Fill in `.env` from `deploy/droplet/env.example`, then `chmod 600 .env`.
4. **Connection budget.** The plan has a connection limit, shown on the database's overview page. Make sure `API_DB_POOL_MAX + 2 × WORKER_DB_POOL_MAX`, plus 1 for migrations, stays under it. The defaults in `env.example` use 13 connections.
   - Use the **direct** connection string (port 25060), not a connection pool. The scheduler's leader lock is a session-level advisory lock, and a transaction-mode pool would silently drop it.

### Cloudflare
1. **Domain.** Add the site's domain to Cloudflare and set SSL/TLS to *Full*.
2. **Tunnel.** Under Zero Trust → Networks → Tunnels, create a tunnel.
   - Copy its token into `TUNNEL_TOKEN`.
   - Add a public hostname, e.g. `autosoccer.example.com`, with service `http://web:3000`.
3. **R2.**
   - Create a bucket, e.g. `autosoccer-replays`, and leave it private. The site serves replays through `web`.
   - Create an R2 API token with *Object Read & Write* on that bucket. Put its key, secret and the account's S3 endpoint into the `R2_*` settings.
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
- **GHCR access for the Droplet.** Either make both container packages public, or run `docker login ghcr.io` on the Droplet with a token that has `read:packages`.
- **Production environment.** Create an environment named `production` with these secrets:

  | Secret | Value |
  | --- | --- |
  | `DEPLOY_HOST` | The Droplet's address |
  | `DEPLOY_USER` | `deploy` |
  | `DEPLOY_SSH_KEY` | A private key whose public half is in `deploy`'s `authorized_keys` |
  | `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan <host>` |

- **Deploy workflow.** `.github/workflows/deploy.yml` builds and pushes both images after CI passes on `main`. It copies `compose.yml` and `deploy.sh` to the Droplet, then runs `./deploy.sh <sha>`. It can also be started by hand, with an optional commit.

## Deploying
```sh
# on the Droplet, as deploy (the CI job does exactly this)
cd /opt/autosoccer
./deploy.sh <git-sha>     # pull missing images → migrate → start → wait for health checks
./deploy.sh --rollback    # back to the previously deployed tag
```
`deploy.sh` refuses to run without `.env` and `ca-certificate.crt`, and only accepts tags made of `[A-Za-z0-9._-]`. Migrations take an advisory lock, are checksummed, and run once per deploy, before the new version starts.

The Compose project is named `autosoccer-droplet`. `deploy.sh` runs `up --remove-orphans`, which removes any container in the same project that the file doesn't define, so never reuse that name for anything else on the host.

## Starting a season
```sh
docker compose -f compose.yml exec api bun scripts/league.ts seed --budget 1.00 --interval 10080   # weekly rounds
```
After that the workers run everything. Monitoring and failure handling are the same as in [runbook.md](runbook.md):
```sh
docker compose -f compose.yml exec api bun run ops status
docker compose -f compose.yml logs -f --since 10m worker
```

## Local rehearsal
`SKIP_TUNNEL=1 ./deploy.sh <tag>` runs the stack without `cloudflared`. To rehearse:
- tag locally built images as `ghcr.io/onomasticon/autosoccer{,-web}:<tag>`;
- point `DATABASE_URL` at any Postgres, with an empty `DATABASE_CA_CERT_FILE` and a placeholder `ca-certificate.crt`;
- point `R2_*` at any S3-compatible endpoint.

Run it from a directory other than the repo, so it can't collide with the dev stack.
