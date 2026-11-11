#!/usr/bin/env bash
# Instala el bot en un servidor Ubuntu (Oracle Cloud) y lo deja corriendo 24/7 como servicio.
# Uso, desde la carpeta crypto-bot en el servidor:  bash deploy/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=$(pwd)

echo "== Verificando acceso a Bybit =="
if curl -fsS "https://api.bybit.com/v5/market/time" >/dev/null; then echo "Bybit OK"; else echo "ERROR: Bybit no responde desde este servidor"; exit 1; fi

echo "== Node.js =="
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node --version

echo "== Servicio crypto-bot =="
sudo tee /etc/systemd/system/crypto-bot.service >/dev/null <<EOF
[Unit]
Description=crypto-bot paper trading (futuros, dinero simulado)
After=network-online.target
Wants=network-online.target

[Service]
User=$(whoami)
WorkingDirectory=$DIR
ExecStart=$(command -v node) scripts/paper.js
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now crypto-bot
sleep 20
systemctl --no-pager --lines=0 status crypto-bot | head -3
echo
tail -n 5 state/paper_*.log 2>/dev/null || echo "(el log aparece en unos segundos)"
echo
echo "Listo. Comandos útiles:"
echo "  cat ~/crypto-bot/state/RESUMEN.md          # cómo va"
echo "  tail -f ~/crypto-bot/state/paper_*.log     # log en vivo (Ctrl+C para salir)"
echo "  sudo systemctl restart crypto-bot          # reiniciar"
echo "  sudo systemctl stop crypto-bot             # detener"
