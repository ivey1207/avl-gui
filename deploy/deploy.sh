#!/usr/bin/env bash
# Run ON YOUR MAC: builds the frontend, uploads the project to the server and runs setup-server.sh there.
# Needs SSH key access to the server (ssh-copy-id root@HOST once).
# Usage: deploy/deploy.sh [user@host]
set -euo pipefail
HOST="${1:?Usage: deploy/deploy.sh root@SERVER_IP}"
APP=/opt/avl-gui
cd "$(dirname "$0")/.."

echo "==> Building frontend"
(cd frontend && { [ -d node_modules ] || npm ci; } && npm run build)

echo "==> Uploading to $HOST:$APP"
ssh "$HOST" "mkdir -p $APP"
rsync -az --delete \
  --exclude '.git/' --exclude '.claude/' --exclude '.DS_Store' \
  --exclude 'node_modules/' --exclude 'venv/' --exclude '__pycache__/' \
  --exclude '*.o' --exclude '*.a' --exclude '/avl/bin/avl' --exclude '/avl/plotlib/config.make' \
  --exclude '/examples/_gui_*' --exclude '/backend/data/' \
  ./ "$HOST:$APP/"

echo "==> Setting up server"
ssh "$HOST" "bash $APP/deploy/setup-server.sh"

echo "==> Live at http://${HOST#*@}/"
