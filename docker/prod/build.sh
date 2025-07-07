#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FAIL=0
pids=()

docker build -t portfolio-builder -f "$SCRIPT_DIR/common/Dockerfile.builder" "$SCRIPT_DIR/../.." &
pids+=($!)
docker build -t portfolio-http-server -f "$SCRIPT_DIR/common/Dockerfile.http-server" "$SCRIPT_DIR/../.." &
pids+=($!)

for pid in "${pids[@]}"; do
  wait "$pid" || FAIL=$((FAIL+1))
done

if [ "$FAIL" -eq 0 ]; then
  docker-compose --file "$SCRIPT_DIR/compose.yml" build && docker-compose --file "$SCRIPT_DIR/compose.yml" up
else
  echo "Builder or HTTP server failed to start."
fi
