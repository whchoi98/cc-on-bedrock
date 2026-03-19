#!/bin/bash
set -euo pipefail

echo "=== LiteLLM Container Integration Tests ==="
IMAGE="${1:-cc-on-bedrock/litellm:latest}"
CONTAINER_NAME="litellm-integration-test"
FAIL=0

cleanup() {
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
}
trap cleanup EXIT

# Start container (will fail on DB but entrypoint should work)
echo "Starting container from $IMAGE..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -p 14000:4000 \
  -e LITELLM_MASTER_KEY=sk-test-key \
  -e DATABASE_URL=postgresql://test:test@localhost:5432/test \
  -e REDIS_HOST=localhost \
  -e REDIS_PASSWORD=test \
  "$IMAGE"

sleep 10

# Test 1: Required binaries
for bin in aws jq envsubst; do
  echo -n "Test 1 - binary '$bin': "
  if docker exec "$CONTAINER_NAME" which "$bin" > /dev/null 2>&1; then
    echo "PASS"
  else
    echo "FAIL"; FAIL=1
  fi
done

# Test 2: Config template was resolved
echo -n "Test 2 - config resolved: "
if docker exec "$CONTAINER_NAME" cat /tmp/litellm-config-resolved.yaml 2>/dev/null | grep -q "sk-test-key"; then
  echo "PASS (master_key substituted)"
else
  echo "FAIL (envsubst may not have run)"; FAIL=1
fi

# Test 3: Entrypoint ran (check logs)
echo -n "Test 3 - entrypoint executed: "
if docker logs "$CONTAINER_NAME" 2>&1 | grep -q "CC-on-Bedrock LiteLLM Proxy Starting"; then
  echo "PASS"
else
  echo "FAIL"; FAIL=1
fi

echo "=== LiteLLM tests complete (failures: $FAIL) ==="
exit $FAIL
