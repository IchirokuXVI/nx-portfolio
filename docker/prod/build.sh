FAIL=0
pids=()

docker build -t portfolio-builder -f ./common/Dockerfile.builder ../.. &
pids+=($!)
docker build -t portfolio-http-server -f ./common/Dockerfile.http-server ../.. &
pids+=($!)

for pid in "${pids[@]}"; do
  wait "$pid" || FAIL=$((FAIL+1))
done

if [ "$FAIL" -eq 0 ]; then
  docker-compose build && docker-compose up
else
  echo "Builder or HTTP server failed to start."
fi
