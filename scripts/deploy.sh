#!/usr/bin/env bash
#
# First-time setup of AME on a fresh Ubuntu server (22.04 or later).
#
#   sudo ./scripts/deploy.sh
#
# Before you start:
#   1. Point the DNS record of your domain to the IP address of this server.
#   2. Open ports 22, 80 and 443 in the firewall of your cloud provider.
#      For the TURN relay, also open 3478 (UDP and TCP) and 49160-49200 (UDP).
#
# The script installs Node.js, PostgreSQL, Redis, nginx, certbot and PM2,
# and optionally coturn. It runs AME as the system user "ame" from /opt/ame.
# After the first setup, use scripts/update.sh to install a new version.

set -euo pipefail

# ── Settings ─────────────────────────────────────────────────────────
RepoUrl="${REPO_URL:-https://github.com/JH-Eric-Yang/AME.git}"
Branch="${BRANCH:-main}"
AppDir="/opt/ame"
AppUser="ame"
LogDir="/var/log/ame"
NodeMajor=22
ServerPort=3001
ClientPort=3000
TurnPort=3478
TurnMinPort=49160
TurnMaxPort=49200
MinPasswordLength=8

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
fail() { echo -e "${RED}[x]${NC} $*" >&2; exit 1; }
step() { echo -e "\n${CYAN}== $* ==${NC}"; }

# Runs a command as the app user, from a directory, with a login-free shell.
as_app() { local dir="$1"; shift; sudo -u "$AppUser" -H bash -c "cd '$dir' && $*"; }

[[ $EUID -eq 0 ]] || fail "Run this script as root, for example with sudo."
command -v apt-get >/dev/null || fail "This script needs Ubuntu or Debian (apt-get)."

# ── Questions ────────────────────────────────────────────────────────
read -rp "Domain name (for example ame.example.org): " Domain
[[ -n "$Domain" ]] || fail "A domain name is necessary."
read -rp "Administrator email (also for the HTTPS certificate): " AdminEmail
[[ "$AdminEmail" == *@* ]] || fail "\"$AdminEmail\" is not an email address."
read -rp "Administrator name [Platform Admin]: " AdminName
AdminName="${AdminName:-Platform Admin}"
read -rsp "Administrator password (${MinPasswordLength} characters or more): " AdminPassword && echo
read -rsp "Type the password again: " PasswordCheck && echo
[[ "$AdminPassword" == "$PasswordCheck" ]] || fail "The two passwords are not the same."
(( ${#AdminPassword} >= MinPasswordLength )) || fail "The password must have ${MinPasswordLength} characters or more."
read -rp "Install a TURN relay (coturn) for video calls on strict networks? [Y/n]: " InstallTurn
InstallTurn="${InstallTurn:-y}"

# ── 1. System packages ───────────────────────────────────────────────
step "1/8 Install the system packages"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git openssl ufw \
  postgresql redis-server nginx certbot python3-certbot-nginx

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt $NodeMajor ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NodeMajor}.x" | bash -
  apt-get install -y -qq nodejs
fi
command -v pm2 >/dev/null || npm install -g pm2

systemctl enable --now postgresql redis-server nginx
ok "Node.js $(node -v), PM2 $(pm2 -v), PostgreSQL, Redis and nginx"

# ── 2. App user ──────────────────────────────────────────────────────
step "2/8 Make the app user"

id "$AppUser" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$AppUser"
mkdir -p "$LogDir"
chown "$AppUser:$AppUser" "$LogDir"
ok "User $AppUser"

# ── 3. Database ──────────────────────────────────────────────────────
step "3/8 Make the database"

DbPassword="$(openssl rand -hex 24)"
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='ame'" | grep -q 1; then
  sudo -u postgres psql -qc "ALTER USER ame WITH PASSWORD '${DbPassword}';"
else
  sudo -u postgres psql -qc "CREATE USER ame WITH PASSWORD '${DbPassword}';"
fi
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='ame'" | grep -q 1 \
  || sudo -u postgres psql -qc "CREATE DATABASE ame OWNER ame;"
ok "Database ame, owned by user ame"

# ── 4. Code ──────────────────────────────────────────────────────────
step "4/8 Get the code"

if [[ -d "$AppDir/.git" ]]; then
  warn "$AppDir exists. The script gets the latest code."
  as_app "$AppDir" "git pull --ff-only"
else
  mkdir -p "$AppDir"
  chown "$AppUser:$AppUser" "$AppDir"
  sudo -u "$AppUser" git clone --branch "$Branch" "$RepoUrl" "$AppDir"
fi
ok "Code in $AppDir"

# ── 5. Configuration ─────────────────────────────────────────────────
step "5/8 Write the configuration"

TurnSecret="$(openssl rand -hex 32)"
EnvFile="$AppDir/.env"
{
  echo "DATABASE_URL=\"postgresql://ame:${DbPassword}@localhost:5432/ame\""
  echo "REDIS_URL=\"redis://localhost:6379\""
  echo "JWT_SECRET=\"$(openssl rand -base64 48 | tr -d '\n')\""
  echo "PORT=${ServerPort}"
  echo "CLIENT_URL=\"https://${Domain}\""
  echo "VITE_SERVER_URL=\"https://${Domain}\""
  if [[ "${InstallTurn,,}" == y* ]]; then
    echo "TURN_URLS=\"turn:${Domain}:${TurnPort}?transport=udp,turn:${Domain}:${TurnPort}?transport=tcp\""
    echo "TURN_SECRET=\"${TurnSecret}\""
  fi
} > "$EnvFile"
chown "$AppUser:$AppUser" "$EnvFile"
chmod 600 "$EnvFile"
ok "Wrote $EnvFile"

# ── 6. Build ─────────────────────────────────────────────────────────
step "6/8 Install, migrate and build"

as_app "$AppDir" "npm ci"
as_app "$AppDir/server" "npx prisma generate"
sudo -u "$AppUser" -H env DATABASE_URL="postgresql://ame:${DbPassword}@localhost:5432/ame" \
  bash -c "cd '$AppDir/server' && npx prisma migrate deploy"
# The password goes to the seed only. The script does not write it to a file.
sudo -u "$AppUser" -H env ADMIN_EMAIL="$AdminEmail" ADMIN_NAME="$AdminName" ADMIN_PASSWORD="$AdminPassword" \
  bash -c "cd '$AppDir/server' && npx prisma db seed"
as_app "$AppDir" "npm run build --workspace client"
ok "Database migrated, administrator made, client built"

# ── 7. Processes ─────────────────────────────────────────────────────
step "7/8 Start the processes with PM2"

cat > "$AppDir/ecosystem.config.cjs" <<EOF
// Made by scripts/deploy.sh. Git ignores this file.
module.exports = {
  apps: [
    {
      name: "ame-server",
      cwd: "./server",
      script: "./node_modules/.bin/tsx",
      args: "--env-file=../.env src/app.ts",
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
      error_file: "${LogDir}/server-error.log",
      out_file: "${LogDir}/server-out.log",
    },
    {
      name: "ame-client",
      cwd: "./client",
      script: "build/index.js",
      env: { NODE_ENV: "production", PORT: ${ClientPort}, ORIGIN: "https://${Domain}" },
      max_memory_restart: "512M",
      error_file: "${LogDir}/client-error.log",
      out_file: "${LogDir}/client-out.log",
    },
  ],
};
EOF
chown "$AppUser:$AppUser" "$AppDir/ecosystem.config.cjs"

as_app "$AppDir" "pm2 startOrReload ecosystem.config.cjs && pm2 save"
env PATH="$PATH" pm2 startup systemd -u "$AppUser" --hp "/home/$AppUser" >/dev/null
ok "PM2 runs ame-server (port $ServerPort) and ame-client (port $ClientPort), also after a reboot"

# ── 8. Web server, HTTPS, firewall and TURN ──────────────────────────
step "8/8 Configure nginx, HTTPS, the firewall and TURN"

# A quoted heredoc keeps the nginx variables ($host, $http_upgrade) as they are.
cat > /etc/nginx/sites-available/ame <<'EOF'
server {
    listen 80;
    server_name __DOMAIN__;

    # REST API and tus uploads.
    location /api/ {
        proxy_pass http://127.0.0.1:__SERVER_PORT__;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 500M;
        proxy_request_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    location = /health {
        proxy_pass http://127.0.0.1:__SERVER_PORT__;
    }

    # Socket.IO needs the WebSocket upgrade.
    location /socket.io/ {
        proxy_pass http://127.0.0.1:__SERVER_PORT__;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
    }

    # The SvelteKit client.
    location / {
        proxy_pass http://127.0.0.1:__CLIENT_PORT__;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sed -i -e "s|__DOMAIN__|${Domain}|g" -e "s|__SERVER_PORT__|${ServerPort}|g" -e "s|__CLIENT_PORT__|${ClientPort}|g" \
  /etc/nginx/sites-available/ame
ln -sf /etc/nginx/sites-available/ame /etc/nginx/sites-enabled/ame
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
ok "nginx"

ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null

if [[ "${InstallTurn,,}" == y* ]]; then
  apt-get install -y -qq coturn
  cat > /etc/turnserver.conf <<EOF
# Made by scripts/deploy.sh for AME.
listening-port=${TurnPort}
min-port=${TurnMinPort}
max-port=${TurnMaxPort}
fingerprint
use-auth-secret
static-auth-secret=${TurnSecret}
realm=${Domain}
no-cli
no-multicast-peers
no-tlsv1
no-tlsv1_1
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
EOF
  chmod 640 /etc/turnserver.conf
  chown root:turnserver /etc/turnserver.conf 2>/dev/null || true
  [[ -f /etc/default/coturn ]] && sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  systemctl enable coturn >/dev/null
  systemctl restart coturn
  ufw allow "${TurnPort}/udp" >/dev/null
  ufw allow "${TurnPort}/tcp" >/dev/null
  ufw allow "${TurnMinPort}:${TurnMaxPort}/udp" >/dev/null
  ok "coturn on port $TurnPort, relay ports $TurnMinPort-$TurnMaxPort"
fi

ufw --force enable >/dev/null
ok "Firewall (ufw)"

if certbot --nginx -d "$Domain" --non-interactive --agree-tos -m "$AdminEmail" --redirect; then
  ok "HTTPS certificate for $Domain"
else
  warn "certbot failed. Make sure that the DNS record of $Domain points to this server."
  warn "Then run: sudo certbot --nginx -d $Domain --redirect"
fi

# ── Done ─────────────────────────────────────────────────────────────
echo
echo -e "${GREEN}AME runs at https://${Domain}${NC}"
echo
echo "  Log in:          https://${Domain}/admin/login as ${AdminEmail}"
echo "  Configuration:   ${EnvFile}"
echo "  Processes:       sudo -u ${AppUser} pm2 status"
echo "  Logs:            ${LogDir}/"
echo "  New version:     sudo ${AppDir}/scripts/update.sh"
echo
warn "Browsers give camera access only on an HTTPS page."
warn "If your cloud provider has its own firewall, open the same ports there."
