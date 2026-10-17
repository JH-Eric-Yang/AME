#!/usr/bin/env bash
#
# Installs the latest version of AME on a server that scripts/deploy.sh set up.
#
#   sudo /opt/ame/scripts/update.sh

set -euo pipefail

AppDir="/opt/ame"
AppUser="ame"

[[ $EUID -eq 0 ]] || { echo "Run this script as root, for example with sudo." >&2; exit 1; }

as_app() { local dir="$1"; shift; sudo -u "$AppUser" -H bash -c "cd '$dir' && $*"; }

DatabaseUrl="$(grep -E '^DATABASE_URL=' "$AppDir/.env" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"

echo "Get the latest code"
as_app "$AppDir" "git pull --ff-only"

echo "Install the packages"
as_app "$AppDir" "npm ci"
as_app "$AppDir/server" "npx prisma generate"

echo "Apply the database migrations"
sudo -u "$AppUser" -H env DATABASE_URL="$DatabaseUrl" bash -c "cd '$AppDir/server' && npx prisma migrate deploy"

echo "Build the client"
as_app "$AppDir" "npm run build --workspace client"

echo "Restart the processes"
as_app "$AppDir" "pm2 reload ecosystem.config.cjs && pm2 save"

echo "AME is up to date. Check the processes with: sudo -u $AppUser pm2 status"
