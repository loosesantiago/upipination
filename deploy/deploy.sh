#!/bin/bash
# Copies the checked-out repo into /opt/upipination and restarts the site.
# Installed root-owned at /usr/local/sbin/upipination-deploy and run by the
# GitHub Actions runner via sudo. Never touches data/, .env or node_modules.
set -euo pipefail

SRC="/home/mini-pc/actions-runner/_work/upipination/upipination"
DEST="/opt/upipination"
APP_USER="upipination"

[ -f "$SRC/server.js" ] || { echo "No checkout found at $SRC"; exit 1; }

old_lock=$(sha256sum "$DEST/package-lock.json" 2>/dev/null | cut -d' ' -f1 || true)

rsync -a --delete --chown="$APP_USER:$APP_USER" \
  --exclude='.git/' --exclude='.github/' \
  --exclude='data/' --exclude='.env' \
  --exclude='node_modules/' --exclude='.npm/' \
  "$SRC/" "$DEST/"

new_lock=$(sha256sum "$DEST/package-lock.json" | cut -d' ' -f1)
if [ "$old_lock" != "$new_lock" ] || [ ! -d "$DEST/node_modules" ]; then
  echo "Dependencies changed, running npm ci..."
  cd "$DEST"
  sudo -u "$APP_USER" env HOME="$DEST" npm ci --omit=dev
fi

systemctl restart upipination
sleep 3
systemctl is-active --quiet upipination || { journalctl -u upipination -n 30 --no-pager; exit 1; }
echo "Deployed $(cd "$SRC" && git rev-parse --short HEAD 2>/dev/null || echo '?')"
