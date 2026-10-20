#!/bin/sh
# Deploy sul Raspberry Pi 5 (alias ssh "pi5"): il container sta sulla rete docker "proxy", Caddy lo serve come
# systemsengineering.centemeri.net (blocco nel Caddyfile in /home/fra/caddy).
set -e

PI_TARGET="pi5"
REMOTE_DIR="/home/fra/nespresso-cell"

ssh -o BatchMode=yes "$PI_TARGET" "mkdir -p $REMOTE_DIR"
rsync -az --delete --exclude node_modules --exclude .git --exclude dist --exclude '*.jpeg' ./ "$PI_TARGET:$REMOTE_DIR/"
ssh -o BatchMode=yes "$PI_TARGET" "cd $REMOTE_DIR && docker compose up -d --build"
echo "Deploy completato: https://systemsengineering.centemeri.net"
