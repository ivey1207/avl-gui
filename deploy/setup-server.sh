#!/usr/bin/env bash
# Runs ON THE SERVER as root (deploy.sh calls it after uploading the code to /opt/avl-gui).
# Installs packages, builds the AVL solver, sets up the backend service and nginx.
# Safe to run again on every deploy. Set REBUILD_AVL=1 to force a rebuild of the solver.
set -euo pipefail
APP=/opt/avl-gui
cd "$APP"

echo "==> Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq gfortran gcc make libx11-dev python3-venv nginx >/dev/null

echo "==> AVL solver"
if [ ! -x /usr/local/bin/avl ] || [ -n "${REBUILD_AVL:-}" ]; then
  (cd avl/plotlib && make gfortranDP)
  (cd avl/eispack && make -f Makefile.gfortran)
  (cd avl/bin && make -f Makefile.gfortran avl BINDIR=/usr/local/bin/)
  # make skips its own install step when avl is already built, so install explicitly.
  install -m 755 avl/bin/avl /usr/local/bin/avl
fi

echo "==> Service user"
id avl >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin avl
chown -R avl:avl "$APP/examples"

echo "==> Python backend"
[ -x backend/venv/bin/python ] || python3 -m venv backend/venv
backend/venv/bin/pip install -q --upgrade pip
backend/venv/bin/pip install -q -r backend/requirements.txt

install -m 644 deploy/avl-gui.service /etc/systemd/system/avl-gui.service
systemctl daemon-reload
systemctl enable avl-gui >/dev/null
systemctl restart avl-gui

echo "==> nginx"
install -m 644 deploy/nginx-avl-gui.conf /etc/nginx/sites-available/avl-gui
ln -sf /etc/nginx/sites-available/avl-gui /etc/nginx/sites-enabled/avl-gui
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx >/dev/null
systemctl reload nginx || systemctl restart nginx

echo "==> Done"
