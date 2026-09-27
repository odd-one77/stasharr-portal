#!/usr/bin/env bash
# Fresh-install Stasharr into a new, unprivileged Proxmox LXC container.
#
# Run this ON THE PROXMOX HOST as root (it uses `pct`, which only exists there).
# It creates a Debian LXC, installs Docker inside it, clones this fork's
# development branch, builds the app image from source, and starts the stack
# with a compose.yaml that matches the layout already used in production
# (postgres + app, image "stasharr-portal:custom").
#
# All configuration can be overridden via environment variables, e.g.:
#   CTID=150 HOSTNAME=stasharr APP_PORT=3000 ./install-stasharr-lxc.sh
set -euo pipefail

# ---- Configuration (override via env vars) ----
CTID="${CTID:-}"                                   # LXC ID; auto-picked if empty
HOSTNAME_="${HOSTNAME:-stasharr}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"       # storage holding the CT template
TEMPLATE="${TEMPLATE:-debian-12-standard_12.7-1_amd64.tar.zst}"
ROOTFS_STORAGE="${ROOTFS_STORAGE:-local-lvm}"       # storage for the container's disk
DISK_GB="${DISK_GB:-12}"
CORES="${CORES:-2}"
MEMORY_MB="${MEMORY_MB:-2048}"
SWAP_MB="${SWAP_MB:-512}"
BRIDGE="${BRIDGE:-vmbr0}"
NET_CONFIG="${NET_CONFIG:-ip=dhcp}"                 # e.g. "ip=192.168.1.50/24,gw=192.168.1.1"
REPO_URL="${REPO_URL:-https://github.com/odd-one77/stasharr-portal.git}"
REPO_BRANCH="${REPO_BRANCH:-add-remove-request}"    # this is what's actually deployed today
APP_PORT="${APP_PORT:-3000}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

if [[ -z "$POSTGRES_PASSWORD" ]]; then
  POSTGRES_PASSWORD="$(openssl rand -hex 16)"
fi

# ---- Sanity checks ----
if ! command -v pct >/dev/null 2>&1; then
  echo "error: 'pct' not found. Run this script on the Proxmox VE host, not inside a container." >&2
  exit 1
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "error: run as root." >&2
  exit 1
fi

if [[ -z "$CTID" ]]; then
  CTID="$(pvesh get /cluster/nextid)"
fi

if pct status "$CTID" >/dev/null 2>&1; then
  echo "error: CTID $CTID already exists. Pick a different CTID=..." >&2
  exit 1
fi

echo "==> Using CTID $CTID, hostname '$HOSTNAME_'"

# ---- Ensure the LXC template is available ----
if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -q "$TEMPLATE"; then
  echo "==> Downloading template $TEMPLATE onto $TEMPLATE_STORAGE"
  pveam update
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi

# ---- Create and start the container ----
echo "==> Creating LXC $CTID"
pct create "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
  --hostname "$HOSTNAME_" \
  --cores "$CORES" \
  --memory "$MEMORY_MB" \
  --swap "$SWAP_MB" \
  --net0 "name=eth0,bridge=${BRIDGE},${NET_CONFIG}" \
  --rootfs "${ROOTFS_STORAGE}:${DISK_GB}" \
  --unprivileged 1 \
  --features nesting=1,keyctl=1 \
  --onboot 1

echo "==> Starting LXC $CTID"
pct start "$CTID"

echo "==> Waiting for network inside the container"
for _ in $(seq 1 30); do
  if pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# ---- In-container provisioning script ----
PROVISION_LOCAL="$(mktemp)"
cat > "$PROVISION_LOCAL" <<PROVISION_EOF
#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl git

echo "==> Installing Docker"
curl -fsSL https://get.docker.com | sh

echo "==> Cloning ${REPO_URL} (branch ${REPO_BRANCH})"
mkdir -p /opt/stasharr-src
git clone --branch "${REPO_BRANCH}" "${REPO_URL}" /opt/stasharr-src

echo "==> Building stasharr-portal:custom (this compiles the app, can take a few minutes)"
cd /opt/stasharr-src
docker build -t stasharr-portal:custom .

mkdir -p /opt/stasharr
cd /opt/stasharr
docker compose up -d

echo "==> Waiting for the app container to report healthy"
for _ in \$(seq 1 60); do
  status="\$(docker inspect -f '{{.State.Health.Status}}' stasharr-app-1 2>/dev/null || echo starting)"
  if [[ "\$status" == "healthy" ]]; then
    echo "App is healthy."
    break
  fi
  sleep 5
done
PROVISION_EOF

echo "==> Writing compose.yaml"
COMPOSE_LOCAL="$(mktemp)"
cat > "$COMPOSE_LOCAL" <<COMPOSE_EOF
x-db-env: &db-env
  POSTGRES_DB: stasharr
  POSTGRES_USER: stasharr
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}

services:
  postgres:
    image: postgres:17-alpine
    environment:
      <<: *db-env
    volumes:
      - stasharr_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U \$\$POSTGRES_USER -d \$\$POSTGRES_DB']
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s
    restart: unless-stopped

  app:
    image: stasharr-portal:custom
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - stasharr_app_data:/var/lib/stasharr
    environment:
      <<: *db-env
      DATABASE_HOST: postgres
      DATABASE_URL: ""
      HOST: 0.0.0.0
      PORT: 3000
      DATABASE_MIGRATION_MAX_ATTEMPTS: 30
      DATABASE_MIGRATION_RETRY_DELAY_SECONDS: 2
      # Flip to "true" once this is served over HTTPS (e.g. behind Nginx Proxy Manager).
      SESSION_COOKIE_SECURE: "false"
    ports:
      - "${APP_PORT}:3000"
    restart: unless-stopped

volumes:
  stasharr_postgres_data:
    name: stasharr_postgres_data
  stasharr_app_data:
    name: stasharr_app_data
COMPOSE_EOF

pct exec "$CTID" -- mkdir -p /opt/stasharr
pct push "$CTID" "$COMPOSE_LOCAL" /opt/stasharr/compose.yaml
pct push "$CTID" "$PROVISION_LOCAL" /root/provision.sh
pct exec "$CTID" -- chmod +x /root/provision.sh

echo "==> Running provisioning script inside the container (this will take a few minutes)"
pct exec "$CTID" -- /root/provision.sh

rm -f "$PROVISION_LOCAL" "$COMPOSE_LOCAL"

CT_IP="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"

cat <<SUMMARY

==> Done.
    Container:        CTID $CTID ("$HOSTNAME_")
    Repo:              ${REPO_URL} @ ${REPO_BRANCH}
    Postgres password: ${POSTGRES_PASSWORD}
    Compose file:      /opt/stasharr/compose.yaml (inside the container)
    Source checkout:   /opt/stasharr-src (inside the container)

    Open http://${CT_IP}:${APP_PORT} to complete first-run setup (bootstrap admin,
    then configure your catalog provider, Stash, and Whisparr connections).

    To redeploy after pulling new commits:
      pct exec ${CTID} -- bash -c 'cd /opt/stasharr-src && git pull && docker build -t stasharr-portal:custom . && cd /opt/stasharr && docker compose up -d --force-recreate app'
SUMMARY
