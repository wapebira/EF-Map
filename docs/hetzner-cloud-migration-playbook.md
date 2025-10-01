# Hetzner Cloud Migration Playbook

_Last updated: 2025-10-01_

## 1. Goal
Migrate the EF-Map auxiliary infrastructure (Primordium pg-indexer, Postgres datastore, Grafana dashboards, diagnostics utilities) from a single Windows workstation into a Hetzner Cloud virtual private server (VPS) while keeping the Cloudflare-hosted frontend untouched. The VPS must become the authoritative host for chain ingestion, analytics, and supporting services. All steps in this playbook are designed so an LLM agent can execute them autonomously using Hetzner's CLI/API.

## 2. Current Local Stack Snapshot
| Component | Purpose | Runtime today |
| --- | --- | --- |
| Primordium pg-indexer (Docker stack) | Streams MUD logs into Postgres, handles confirm depth, exposes health endpoints | Docker Desktop on Windows, scheduled task auto-start |
| Postgres 16 | Stores decoded chain data and World API snapshots | Docker container with bind-mounted volumes |
| Grafana | Visualizes ingest health and metrics | Docker container, http://localhost:3000 |
| Metrics server (port 8733) | Serves ingest dashboards & JSON summaries | Node.js script (`tools/local-indexer/metrics_server.js`) |
| Supporting scripts | Snapshot exporter, KV reseed helpers, diagnostics | PowerShell/Node scripts run manually |
| Secrets & env | Stored in `.env` / Windows Credential Manager (refer to `docs/LOCAL_ENVIRONMENT.md`) | Local only |

## 3. Target Hetzner Architecture
- **Compute**: 1 × `cx22` instance (2 vCPU, 4 GB RAM, 40 GB NVMe) in Falkenstein (fsn1) or Helsinki (hel1). Upgrade to `cx32` (8 GB RAM) if memory pressure observed.
- **Storage**: Attach an additional 80 GB volume for Postgres data directory (`/var/lib/postgresql/data`). Snapshots managed via CLI.
- **OS image**: Ubuntu 22.04 LTS (minimal).
- **Networking**: Public IPv4 + IPv6. Configure Cloud Firewall to expose only required ports (22, 3000 optional, 8733 optional) and allow ingress from operator IPs.
- **Automation**: Use Hetzner Cloud token, `hcloud` CLI, and Terraform state stored locally (`infra/hetzner/terraform.tfstate`).

## 4. Prerequisites
1. **Accounts & access**
   - Hetzner Cloud project created (name: `ef-map-backend`).
   - API token with write permissions stored in secure secret manager (see `docs/operations-secrets.md`).
2. **Tooling on operator machine / agent runtime**
   - Install `hcloud` CLI (`curl -O https://github.com/hetznercloud/cli/releases/...`).
   - Optional: Terraform ≥1.6 with Hetzner provider (`provider "hcloud" { token = env.HCLOUD_TOKEN }`).
   - SSH key pair dedicated to automation (e.g., `CLOUD_HC_AUTOMATION`). Public key uploaded via CLI.
3. **Configuration artifacts**
   - Existing `docker-compose.yml` for Primordium stack (from local dev folder).
   - `.env` templates sanitized (remove secrets before committing).
   - Postgres backup plan (pg_dump or volume snapshot).

## 5. Migration Stages
1. **Preparation**: Export database + configs, sanitize secrets, verify container images.
2. **Provisioning**: Create VPS, firewall, and volume through CLI or Terraform.
3. **Bootstrap**: Configure OS, install Docker, restore data, seed services.
4. **Validation**: Run health checks, compare Grafana panels, ensure metrics server parity.
5. **Cutover**: Disable local stack, update documentation, monitor remote instance.
6. **Enhancements**: Automate backups, establish monitoring alerts, plan scaling.

## 6. Detailed Procedures (LLM-Friendly)
### 6.1 Preparation (run locally)
- Export Postgres dump:
  ```powershell
  docker exec -t postgres pg_dump -U efmap -Fc efmap > backups/efmap_$(Get-Date -Format yyyyMMdd).dump
  ```
- Archive Grafana provisioning assets (`/var/lib/grafana` directories) and metrics server configs.
- Collect `.env` variables from `docs/LOCAL_ENVIRONMENT.md` (without committing secrets).
- Build container images locally (if custom) or record image tags for pull on VPS.

### 6.2 Provision Hetzner Resources
Use CLI so the agent can execute commands itself.
1. Authenticate CLI:
   ```powershell
   $env:HCLOUD_TOKEN = '<paste from secret manager>'
   hcloud context create ef-map-backend
   ```
2. Upload SSH key:
   ```powershell
   hcloud ssh-key create --name ef-map-ci --public-key "$(Get-Content ~/.ssh/ef-map-ci.pub)"
   ```
3. Create firewall:
   ```powershell
   hcloud firewall create --name ef-map-vps --rule "direction=in action=allow protocol=tcp port=22 source_ips=<operator IP>/32" --rule "direction=in action=allow protocol=tcp port=3000 source_ips=<operator IP>/32" --rule "direction=in action=allow protocol=tcp port=8733 source_ips=<operator IP>/32"
   ```
4. Provision server + volume:
   ```powershell
   hcloud server create --name ef-map-vps --type cx22 --image ubuntu-22.04 --location fsn1 --ssh-key ef-map-ci --firewall ef-map-vps
   hcloud volume create --name ef-map-data --size 80 --server ef-map-vps --format ext4
   ```
5. Record outputs (IP addresses, volume ID) in `docs/operations-secrets.md` (manual update).

_Optional Terraform module (`infra/hetzner/main.tf`) can describe the same resources for reproducibility._

### 6.3 Bootstrap VPS (agent via SSH)
1. Configure base OS:
   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y docker.io docker-compose-plugin git fail2ban ufw
   sudo usermod -aG docker $USER
   ```
2. Mount data volume:
   ```bash
   sudo mkfs.ext4 /dev/disk/by-id/scsi-0HC_Volume_* # if not preformatted
   sudo mkdir -p /srv/ef-map/postgres
   echo '/dev/disk/by-id/scsi-0HC_Volume_* /srv/ef-map/postgres ext4 defaults 0 2' | sudo tee -a /etc/fstab
   sudo mount -a
   ```
3. Fetch infrastructure repo (read-only):
   ```bash
   git clone https://github.com/Diabolacal/EF-Map-main.git /srv/ef-map/repo
   ```
4. Restore Postgres data:
   ```bash
   docker compose -f /srv/ef-map/repo/tools/primordium/docker-compose.yml up -d postgres
   docker exec -i ef-map-postgres pg_restore -U efmap -d efmap < efmap.dump
   ```
5. Bring up remaining services (indexer, grafana, metrics server) via Docker Compose.

### 6.4 Validation Checklist
- `curl http://localhost:8733/api/health` → status ok.
- Grafana reachable at `https://<VPS_IP>:3000` (optional HTTP → add reverse proxy).
- Indexer logs show progress; confirm `docs/decision-log.md` monitoring metrics align.
- Run exporter scripts pointed at new host to validate Cloudflare KV writes (preview first).

### 6.5 Cutover Steps
1. Stop local Docker stack (`docker compose down`).
2. Update automation to target VPS endpoints (Grafana, metrics server URLs).
3. Inform stakeholders; update documentation referencing new host.
4. Monitor for 24h; confirm ingest lag in Grafana remains stable.

### 6.6 Post-Migration Developer Workflow (Hybrid Model)
- **Inner loop stays local**: Keep the existing Docker stack on Windows (or WSL) for feature development, schema experiments, and agent-assisted debugging. This preserves instant feedback and leverages VS Code extensions without additional networking hurdles.
- **Remote VPS as staging authority**: Treat the Hetzner host as the long-running ingestion + analytics environment. Only promote changes that already passed locally by re-running the same automation scripts against the VPS.
- **Access pattern**: Use scripted SSH tunnels so tooling can still connect to Postgres/Grafana securely. Example (`tools/vps/open-tunnel.ps1` placeholder):
   ```powershell
   $env:VPS_IP = '<recorded ip>'
   ssh -N -L 5433:127.0.0.1:5432 -L 9300:127.0.0.1:3000 -L 9733:127.0.0.1:8733 ubuntu@$env:VPS_IP
   ```
   Point the VS Code Postgres extension at `localhost:5433`; Grafana is reachable at `http://localhost:9300` over the tunnel.
- **Data synchronization**: Pull sanitized dumps from the VPS when you need fresh data locally (`pg_dump --schema-only` or filtered dumps). Avoid pushing local experiments back upstream unless they are part of an approved migration.
- **Operational guardrails**: Document tunnel scripts, remote compose commands, and environment variables in `docs/ops/vps-access.md`. Add lightweight monitoring (Grafana alerts, health checks) so regressions on the VPS are noticed quickly.

### 6.7 Troubleshooting & Feature Delivery Flow
| Activity | Recommended location | Steps |
| --- | --- | --- |
| Schema exploration, quick queries | Local workstation | Use VS Code Postgres extension against local containers; refresh data with `pg_dump` pulled from VPS when needed. |
| Exporter / diagnostic script changes | Develop locally → deploy to VPS | Edit & test locally, commit to repo, then run scripted deploy (`ssh ubuntu@<ip> "cd /srv/ef-map/repo && git pull && docker compose ..."`). |
| Ingest or Grafana issues in production/staging | VPS (read-only first) | Establish tunnel, inspect logs via `docker compose logs`, check Grafana panels; capture findings in decision log. |
| Emergency rollback | VPS | Restore latest Hetzner volume snapshot or `pg_restore` from nightly dump; keep local stack ready as fallback reference. |
| Agent-led debugging | Local preferred, VPS when needed | Run troubleshooting playbooks locally whenever possible; when remote access is required, have the agent execute scripted tunnel + SSH commands to keep actions reproducible. |

### 6.8 Cost & Billing Considerations
- **Baseline instance**: CX32 (4 vCPU / 8 GB RAM / 80 GB NVMe) suits the 8 GB requirement at €0.0113 /hr, capped at €6.80 /mo, and includes a primary IPv4 plus 20 TB outbound traffic in EU regions. Choosing the IPv6-only variant trims €0.50 /mo but removes IPv4 connectivity.
- **Traffic overages**: Exceeding the 20 TB pool triggers €1.00 per extra TB (EU/US). Keep an eye on future API exposure; Cloudflare KV writes are tiny but bulk data exports could spike egress.
- **Block storage volumes**: Hetzner charges €0.044 / GB / mo. An 80 GB Postgres volume adds ~€3.52 per month and bills hourly while attached—even if the server stops.
- **Snapshots**: Manual snapshots cost €0.011 / GB / mo. One 80 GB snapshot is ~€0.88 per month; costs scale with the number of snapshots retained.
- **Automated backups**: Enabling the managed backup feature adds 20 % of the instance price each month (~€1.36 for CX32). Disable it if we rely solely on scripted pg_dumps and off-site copies.
- **Load balancers & extras**: Only pay for optional components (e.g., LB11 at €5.39 /mo capped with 20 TB traffic). Floating IPs, networks, and firewalls are free; dedicated vCPU (CCX) plans significantly increase the base rate if we outgrow shared compute.
- **Budgeting tip**: Document snapshot/backup retention and monitor traffic usage so hourly billing for orphaned storage or unexpected egress doesn’t linger after maintenance or restores.

## 7. Risks & Mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Data loss during migration | Critical | Take pg_dump + volume snapshot before move; test restore on staging VPS |
| Under-provisioned resources | Slow ingest, dropped logs | Monitor CPU/RAM; upgrade to `cx32` via CLI (`hcloud server resize`) |
| Exposed services | Security breach | Restrict firewall to operator IPs; consider WireGuard tunnel |
| Secret leakage | Compromised env | Store tokens in secret manager; never commit secrets; use `.env.example` |
| Agent CLI errors | Incomplete automation | Implement Terraform plan/apply with `-auto-approve`; capture logs |
| Region outage | Downtime | Snapshot volumes; document failover plan to secondary region |
| Remote-only debugging friction | Slower feature turnaround | Maintain local dev stack for fast loops; provide documented SSH tunnels and scripted helper commands so agents/operators can reach VPS services quickly. |

## 8. Future Enhancements
- **Automated Backups**: Schedule `hcloud volume snapshot create --server ef-map-vps` daily; sync to object storage.
- **Terraform Pipeline**: Add CI workflow that validates infrastructure plan using GitHub Actions with Hetzner token secrets.
- **Observability**: Ship metrics to Grafana Cloud or Prometheus; configure alerting using PagerDuty/email.
- **Secrets Management**: Adopt sops + age for encrypted configuration in repo.
- **High Availability**: Split Postgres to managed service or replicate to standby VPS; evaluate Hetzner Load Balancer for future HTTP services.
- **Cost Review**: Monitor monthly usage; consider reserved pricing or auto-shutdown for maintenance windows.

## 9. Artifacts to Update Post-Migration
- `docs/LOCAL_ENVIRONMENT.md`: replace local endpoints with Hetzner details.
- `docs/decision-log.md`: add entry summarizing migration timeline and validation results.
- `.env.example`: include new environment variable placeholders where applicable.
- Automation scripts under `tools/` to target remote endpoints.

## 10. Troubleshooting (Quick Reference)
- **Server provisioning failures**: `hcloud server list` to confirm; check quota in Hetzner console.
- **Volume not mounting**: verify `/etc/fstab` entry, run `ls -l /dev/disk/by-id/` to confirm device ID.
- **Docker permission issues**: run `newgrp docker` or re-login after adding user to docker group.
- **Indexer lag**: check RPC endpoint configured; ensure outbound ports open; review logs via `docker logs`.
- **Grafana unreachable**: confirm firewall rule; if using UFW, run `sudo ufw allow 3000/tcp`.

---
This playbook assumes the Cloudflare Pages application remains unchanged; only backend infrastructure is relocated. When executing via LLM, always capture command output and update the decision log with any deviations.
