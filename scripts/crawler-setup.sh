#!/usr/bin/env bash
# Starts Crawl4AI on this computer for the Job Hunt connector.
#
#   npm run crawler:setup
#
# Safe to re-run: it keeps the existing token and replaces the container.
#
# Crawl4AI refuses to listen outside its own container unless it has an API
# token, so one is generated once and kept in ~/.config/job-tracker (mode 600),
# where the connector reads it. The port is published on 127.0.0.1 only —
# nothing else on your network can reach the crawler.
set -euo pipefail

IMAGE="unclecode/crawl4ai:0.9.4"
DIR="${JOB_TRACKER_CONFIG_DIR:-$HOME/.config/job-tracker}"
TOKEN_FILE="$DIR/crawl4ai-token"

command -v docker >/dev/null || { echo "Docker is not installed. Install Docker Desktop first: https://www.docker.com/products/docker-desktop/"; exit 1; }
if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker Desktop…"
  open -a Docker 2>/dev/null || true
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
  docker info >/dev/null 2>&1 || { echo "Docker did not start. Open Docker Desktop, then run this again."; exit 1; }
fi

mkdir -p "$DIR" && chmod 700 "$DIR"
if [ ! -s "$TOKEN_FILE" ]; then
  (umask 077 && openssl rand -hex 32 > "$TOKEN_FILE")
  echo "Created a Crawl4AI token in $TOKEN_FILE"
fi
chmod 600 "$TOKEN_FILE"

echo "Pulling $IMAGE (about 2 GB the first time)…"
docker pull "$IMAGE" >/dev/null
docker rm -f crawl4ai >/dev/null 2>&1 || true
docker run -d --name crawl4ai --restart unless-stopped \
  -p 127.0.0.1:11235:11235 --shm-size=1g \
  -e CRAWL4AI_API_TOKEN="$(cat "$TOKEN_FILE")" \
  "$IMAGE" >/dev/null

printf "Waiting for Crawl4AI"
for _ in $(seq 1 40); do
  if curl -fs -m 3 http://127.0.0.1:11235/health >/dev/null; then echo; break; fi
  printf "."; sleep 2
done
curl -fs -m 3 http://127.0.0.1:11235/health >/dev/null || { echo; echo "Crawl4AI did not come up. See: docker logs crawl4ai"; exit 1; }
echo "Crawl4AI is running on http://127.0.0.1:11235 and restarts with Docker."
echo "Check the job boards with: npm run check:boards"
