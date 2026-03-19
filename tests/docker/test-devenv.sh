#!/bin/bash
set -euo pipefail

echo "=== Devenv Container Integration Tests ==="
IMAGE="${1:-cc-on-bedrock/devenv:ubuntu-latest}"
CONTAINER_NAME="devenv-integration-test"
FAIL=0

cleanup() {
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
}
trap cleanup EXIT

# Start container
echo "Starting container from $IMAGE..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -p 18080:8080 \
  -e SECURITY_POLICY=open \
  -e CODESERVER_AUTH=none \
  -e AWS_DEFAULT_REGION=ap-northeast-2 \
  "$IMAGE"

echo "Waiting for code-server to start..."
sleep 15

# Test 1: code-server is running
echo -n "Test 1 - code-server health: "
if curl -sf http://localhost:18080/healthz > /dev/null 2>&1; then
  echo "PASS"
else
  echo "FAIL"; FAIL=1
fi

# Test 2: Required binaries exist
for bin in node npm python3 aws git curl jq code-server; do
  echo -n "Test 2 - binary '$bin': "
  if docker exec "$CONTAINER_NAME" which "$bin" > /dev/null 2>&1; then
    echo "PASS"
  else
    echo "FAIL"; FAIL=1
  fi
done

# Test 3: Claude Code CLI
echo -n "Test 3 - claude CLI: "
if docker exec "$CONTAINER_NAME" which claude > /dev/null 2>&1; then
  echo "PASS"
else
  echo "WARN (may need manual install)"; # Not a hard fail
fi

# Test 4: Node.js version
echo -n "Test 4 - Node.js v20: "
NODE_VER=$(docker exec "$CONTAINER_NAME" node --version 2>/dev/null || echo "none")
if [[ "$NODE_VER" == v20.* ]]; then
  echo "PASS ($NODE_VER)"
else
  echo "FAIL ($NODE_VER)"; FAIL=1
fi

# Test 5: coder user exists
echo -n "Test 5 - coder user: "
if docker exec "$CONTAINER_NAME" id coder > /dev/null 2>&1; then
  echo "PASS"
else
  echo "FAIL"; FAIL=1
fi

# Test 6: Security policy - restricted mode
echo "Test 6 - restricted security policy:"
cleanup
docker run -d \
  --name "$CONTAINER_NAME" \
  -p 18080:8080 \
  -e SECURITY_POLICY=restricted \
  -e CODESERVER_AUTH=none \
  "$IMAGE"
sleep 10
echo -n "  container starts in restricted mode: "
if docker exec "$CONTAINER_NAME" ps aux | grep -q code-server; then
  echo "PASS"
else
  echo "FAIL"; FAIL=1
fi

echo "=== Devenv tests complete (failures: $FAIL) ==="
exit $FAIL
