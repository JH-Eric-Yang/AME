#!/usr/bin/env bash
#
# First-time setup of AME on a development machine (macOS or Linux).
#
#   ./scripts/setup.sh
#
# The script:
#   1. Checks Node.js, npm, PostgreSQL and Redis.
#   2. Makes .env in the repository root, with a random JWT secret.
#   3. Installs the packages of all workspaces.
#   4. Applies the database migrations.
#   5. Makes the first administrator account.
#
# You can run the script again. It keeps an existing .env and an existing
# administrator account.
#
# For a production server, use scripts/deploy.sh instead.

set -euo pipefail

MinNodeMajor=20
MinNodeMinor=6
MinPasswordLength=8

Root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EnvFile="$Root/.env"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
fail() { echo -e "${RED}[x]${NC} $*" >&2; exit 1; }
step() { echo -e "\n${CYAN}== $* ==${NC}"; }

# ask VAR "Question" "default" — reads a value; an exported VAR skips the question.
ask() {
  local var="$1" question="$2" default="${3:-}" answer
  if [[ -n "${!var:-}" ]]; then return; fi
  if [[ -n "$default" ]]; then
    read -rp "$question [$default]: " answer
    printf -v "$var" '%s' "${answer:-$default}"
  else
    read -rp "$question: " answer
    printf -v "$var" '%s' "$answer"
  fi
}

# Reads one value from .env (the last assignment wins, quotes removed).
env_value() {
  grep -E "^$1=" "$EnvFile" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

random_secret() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64"))'
}

# ── 1. Requirements ──────────────────────────────────────────────────
step "1/5 Check the requirements"

command -v node >/dev/null || fail "Node.js is not installed. Install Node.js ${MinNodeMajor}.${MinNodeMinor} or later."
command -v npm >/dev/null || fail "npm is not installed."

NodeVersion="$(node -p 'process.versions.node')"
NodeMajor="${NodeVersion%%.*}"
NodeMinor="$(echo "$NodeVersion" | cut -d. -f2)"
if (( NodeMajor < MinNodeMajor || (NodeMajor == MinNodeMajor && NodeMinor < MinNodeMinor) )); then
  fail "Node.js $NodeVersion is too old. Install Node.js ${MinNodeMajor}.${MinNodeMinor} or later."
fi
ok "Node.js $NodeVersion"

if command -v pg_isready >/dev/null; then
  if pg_isready -q; then ok "PostgreSQL accepts connections"; else warn "PostgreSQL does not accept connections. Start it before step 4."; fi
else
  warn "pg_isready is not available. Make sure that PostgreSQL runs."
fi

if command -v redis-cli >/dev/null; then
  if redis-cli ping >/dev/null 2>&1; then ok "Redis replies"; else warn "Redis does not reply. Start it before you start the server."; fi
else
  warn "redis-cli is not available. Make sure that Redis runs."
fi

# ── 2. Configuration ─────────────────────────────────────────────────
step "2/5 Make the configuration file"

if [[ -f "$EnvFile" ]]; then
  ok "$EnvFile exists. The script keeps it."
else
  ask DATABASE_URL "PostgreSQL connection string" "postgresql://${USER}@localhost:5432/ame"
  ask REDIS_URL "Redis connection string" "redis://localhost:6379"
  ask PORT "Server port" "3001"

  {
    echo "DATABASE_URL=\"$DATABASE_URL\""
    echo "REDIS_URL=\"$REDIS_URL\""
    echo "JWT_SECRET=\"$(random_secret)\""
    echo "PORT=$PORT"
    echo "CLIENT_URL=http://localhost:5173"
    if [[ "$PORT" != "3001" ]]; then
      # The client uses port 3001 unless it is told otherwise.
      echo "VITE_SERVER_URL=http://localhost:$PORT"
    fi
  } > "$EnvFile"
  chmod 600 "$EnvFile"
  ok "Wrote $EnvFile with a random JWT_SECRET"
fi

# ── 3. Packages ──────────────────────────────────────────────────────
step "3/5 Install the packages"

cd "$Root"
npm install
(cd "$Root/server" && npx prisma generate)
ok "Packages installed"

# ── 4. Database ──────────────────────────────────────────────────────
step "4/5 Apply the database migrations"

# Prisma makes the database if it does not exist. The database user must exist.
(cd "$Root/server" && DATABASE_URL="$(env_value DATABASE_URL)" npx prisma migrate deploy) \
  || fail "The migrations failed. Make sure that PostgreSQL runs and that DATABASE_URL in .env is correct."
ok "Database is ready"

# ── 5. Administrator ─────────────────────────────────────────────────
step "5/5 Make the first administrator account"

ask ADMIN_EMAIL "Administrator email"
[[ "$ADMIN_EMAIL" == *@* ]] || fail "\"$ADMIN_EMAIL\" is not an email address."
ask ADMIN_NAME "Administrator name" "Platform Admin"

if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  read -rsp "Administrator password (${MinPasswordLength} characters or more): " ADMIN_PASSWORD && echo
  read -rsp "Type the password again: " PasswordCheck && echo
  [[ "$ADMIN_PASSWORD" == "$PasswordCheck" ]] || fail "The two passwords are not the same."
fi
(( ${#ADMIN_PASSWORD} >= MinPasswordLength )) || fail "The password must have ${MinPasswordLength} characters or more."

# The password goes to the seed only. The script does not write it to .env.
(cd "$Root/server" && ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_NAME="$ADMIN_NAME" ADMIN_PASSWORD="$ADMIN_PASSWORD" npx prisma db seed)

# ── Done ─────────────────────────────────────────────────────────────
echo
echo -e "${GREEN}AME is ready.${NC}"
echo
echo "Start the server and the client in two terminals:"
echo "  npm run dev --workspace server"
echo "  npm run dev --workspace client"
echo
echo "Then open http://localhost:5173/admin/login and log in as $ADMIN_EMAIL."
echo "To add an example experiment, run: npm run seed:demo"
