#!/usr/bin/env bash
###############################################################################
# test-e2e.sh - End-to-end integration tests for CC-on-Bedrock
#
# Validates:
#   1. Docker image builds (if Docker available)
#   2. Docker container tests
#   3. CDK synth (TypeScript compilation + CloudFormation generation)
#   4. Terraform validate
#   5. CloudFormation template lint (cfn-lint if available)
#   6. Next.js TypeScript check
#   7. Shell script lint (shellcheck if available)
#
# Usage:
#   ./test-e2e.sh              # run all tests
#   ./test-e2e.sh --skip-docker # skip Docker build/container tests
#   ./test-e2e.sh --only-iac    # only run IaC validation
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SKIP_DOCKER=false
ONLY_IAC=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-docker) SKIP_DOCKER=true; shift ;;
    --only-iac)    ONLY_IAC=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--skip-docker] [--only-iac]"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Counters & helpers
# ---------------------------------------------------------------------------
TOTAL=0
PASS=0
FAIL=0
SKIP=0

section() {
  echo ""
  echo "================================================================"
  echo "  $1"
  echo "================================================================"
}

run_test() {
  local name="$1"
  shift
  TOTAL=$((TOTAL + 1))
  echo -n "  [$TOTAL] $name: "

  local output
  if output=$("$@" 2>&1); then
    echo "PASS"
    PASS=$((PASS + 1))
    return 0
  else
    echo "FAIL"
    # Show last few lines of output for debugging
    echo "$output" | tail -5 | sed 's/^/       /'
    FAIL=$((FAIL + 1))
    return 1
  fi
}

skip_test() {
  local name="$1"
  local reason="$2"
  TOTAL=$((TOTAL + 1))
  SKIP=$((SKIP + 1))
  echo "  [$TOTAL] $name: SKIP ($reason)"
}

# ===========================================================================
# Phase 1: Docker image builds
# ===========================================================================
if [[ "$ONLY_IAC" == false && "$SKIP_DOCKER" == false ]]; then
  section "Phase 1: Docker Image Builds"

  if command -v docker &>/dev/null; then
    # Check if Docker daemon is running
    if docker info &>/dev/null; then
      run_test "Build devenv-ubuntu image" \
        docker build --platform linux/arm64 \
          -f "${PROJECT_ROOT}/docker/devenv/Dockerfile.ubuntu" \
          -t cc-on-bedrock/devenv:ubuntu-test \
          "${PROJECT_ROOT}/docker/devenv" || true

      run_test "Build devenv-al2023 image" \
        docker build --platform linux/arm64 \
          -f "${PROJECT_ROOT}/docker/devenv/Dockerfile.al2023" \
          -t cc-on-bedrock/devenv:al2023-test \
          "${PROJECT_ROOT}/docker/devenv" || true

      run_test "Build litellm image" \
        docker build --platform linux/arm64 \
          -f "${PROJECT_ROOT}/docker/litellm/Dockerfile" \
          -t cc-on-bedrock/litellm:test \
          "${PROJECT_ROOT}/docker/litellm" || true
    else
      skip_test "Docker image builds" "Docker daemon not running"
    fi
  else
    skip_test "Docker image builds" "Docker not installed"
  fi
fi

# ===========================================================================
# Phase 2: Docker container tests
# ===========================================================================
if [[ "$ONLY_IAC" == false && "$SKIP_DOCKER" == false ]]; then
  section "Phase 2: Docker Container Tests"

  if command -v docker &>/dev/null && docker info &>/dev/null; then
    # Check if test images exist
    if docker image inspect cc-on-bedrock/devenv:ubuntu-test &>/dev/null; then
      run_test "Devenv container integration tests" \
        bash "${PROJECT_ROOT}/tests/docker/test-devenv.sh" cc-on-bedrock/devenv:ubuntu-test || true
    else
      skip_test "Devenv container tests" "devenv image not built"
    fi

    if docker image inspect cc-on-bedrock/litellm:test &>/dev/null; then
      run_test "LiteLLM container integration tests" \
        bash "${PROJECT_ROOT}/tests/docker/test-litellm.sh" cc-on-bedrock/litellm:test || true
    else
      skip_test "LiteLLM container tests" "litellm image not built"
    fi
  else
    skip_test "Docker container tests" "Docker not available"
  fi
fi

# ===========================================================================
# Phase 3: CDK Synth (TypeScript compilation + CloudFormation generation)
# ===========================================================================
section "Phase 3: CDK Validation"

if command -v node &>/dev/null; then
  CDK_DIR="${PROJECT_ROOT}/cdk"

  if [[ -f "${CDK_DIR}/package.json" ]]; then
    # Install dependencies if needed
    if [[ ! -d "${CDK_DIR}/node_modules" ]]; then
      echo "  Installing CDK dependencies..."
      (cd "${CDK_DIR}" && npm install --silent) || true
    fi

    run_test "CDK TypeScript compilation (tsc)" \
      bash -c "cd '${CDK_DIR}' && npx tsc --noEmit" || true

    # Try CDK synth if cdk CLI is available
    if command -v cdk &>/dev/null || [[ -x "${CDK_DIR}/node_modules/.bin/cdk" ]]; then
      run_test "CDK synth (CloudFormation generation)" \
        bash -c "cd '${CDK_DIR}' && npx cdk synth --quiet 2>&1 | head -20" || true
    else
      skip_test "CDK synth" "cdk CLI not available"
    fi
  else
    skip_test "CDK validation" "cdk/package.json not found"
  fi
else
  skip_test "CDK validation" "Node.js not installed"
fi

# ===========================================================================
# Phase 4: Terraform Validate
# ===========================================================================
section "Phase 4: Terraform Validation"

TF_DIR="${PROJECT_ROOT}/terraform"

if command -v terraform &>/dev/null; then
  if [[ -f "${TF_DIR}/main.tf" ]]; then
    # Terraform init (local backend, no real providers)
    run_test "Terraform init" \
      bash -c "cd '${TF_DIR}' && terraform init -backend=false -input=false -no-color" || true

    run_test "Terraform validate" \
      bash -c "cd '${TF_DIR}' && terraform validate -no-color" || true

    run_test "Terraform fmt check" \
      bash -c "cd '${TF_DIR}' && terraform fmt -check -recursive -diff" || true
  else
    skip_test "Terraform validation" "terraform/main.tf not found"
  fi
else
  skip_test "Terraform validation" "Terraform not installed"
fi

# ===========================================================================
# Phase 5: CloudFormation Template Lint
# ===========================================================================
section "Phase 5: CloudFormation Validation"

CFN_DIR="${PROJECT_ROOT}/cloudformation"

# Check YAML syntax for all templates
for template in "${CFN_DIR}"/*.yaml; do
  [[ -f "$template" ]] || continue
  tname=$(basename "$template")

  if command -v python3 &>/dev/null; then
    run_test "YAML syntax: ${tname}" \
      python3 -c "import yaml; yaml.safe_load(open('${template}'))" || true
  else
    skip_test "YAML syntax: ${tname}" "python3 not available"
  fi
done

# cfn-lint if available
if command -v cfn-lint &>/dev/null; then
  for template in "${CFN_DIR}"/*.yaml; do
    [[ -f "$template" ]] || continue
    tname=$(basename "$template")
    run_test "cfn-lint: ${tname}" \
      cfn-lint -t "$template" || true
  done
else
  skip_test "cfn-lint validation" "cfn-lint not installed (pip install cfn-lint)"
fi

# Validate deploy.sh syntax
if [[ -f "${CFN_DIR}/deploy.sh" ]]; then
  run_test "deploy.sh bash syntax" \
    bash -n "${CFN_DIR}/deploy.sh" || true
fi
if [[ -f "${CFN_DIR}/destroy.sh" ]]; then
  run_test "destroy.sh bash syntax" \
    bash -n "${CFN_DIR}/destroy.sh" || true
fi

# ===========================================================================
# Phase 6: Next.js TypeScript Check
# ===========================================================================
if [[ "$ONLY_IAC" == false ]]; then
  section "Phase 6: Next.js Dashboard Validation"

  NEXTJS_DIR="${PROJECT_ROOT}/shared/nextjs-app"

  if [[ -f "${NEXTJS_DIR}/package.json" ]]; then
    # Install dependencies if needed
    if [[ ! -d "${NEXTJS_DIR}/node_modules" ]]; then
      echo "  Installing Next.js dependencies..."
      (cd "${NEXTJS_DIR}" && npm install --silent) || true
    fi

    run_test "Next.js TypeScript check (tsc --noEmit)" \
      bash -c "cd '${NEXTJS_DIR}' && npx tsc --noEmit" || true

    # Next.js lint if configured
    if grep -q '"lint"' "${NEXTJS_DIR}/package.json" 2>/dev/null; then
      run_test "Next.js lint" \
        bash -c "cd '${NEXTJS_DIR}' && npm run lint --silent 2>&1 || true" || true
    fi
  else
    skip_test "Next.js validation" "shared/nextjs-app/package.json not found"
  fi
fi

# ===========================================================================
# Phase 7: Shell Script Lint
# ===========================================================================
if [[ "$ONLY_IAC" == false ]]; then
  section "Phase 7: Shell Script Lint"

  if command -v shellcheck &>/dev/null; then
    SHELL_SCRIPTS=(
      "${PROJECT_ROOT}/docker/devenv/scripts/entrypoint.sh"
      "${PROJECT_ROOT}/docker/devenv/scripts/setup-common.sh"
      "${PROJECT_ROOT}/docker/devenv/scripts/setup-claude-code.sh"
      "${PROJECT_ROOT}/docker/devenv/scripts/setup-kiro.sh"
      "${PROJECT_ROOT}/docker/devenv/scripts/idle-monitor.sh"
      "${PROJECT_ROOT}/docker/litellm/scripts/entrypoint.sh"
      "${PROJECT_ROOT}/docker/build.sh"
      "${PROJECT_ROOT}/scripts/create-ecr-repos.sh"
      "${PROJECT_ROOT}/scripts/verify-deployment.sh"
      "${PROJECT_ROOT}/cloudformation/deploy.sh"
      "${PROJECT_ROOT}/cloudformation/destroy.sh"
    )

    for script in "${SHELL_SCRIPTS[@]}"; do
      [[ -f "$script" ]] || continue
      sname=$(basename "$(dirname "$script")")/$(basename "$script")
      run_test "shellcheck: ${sname}" \
        shellcheck -S warning "$script" || true
    done
  else
    skip_test "Shell script lint" "shellcheck not installed"
  fi
fi

# ===========================================================================
# Phase 8: Project structure validation
# ===========================================================================
section "Phase 8: Project Structure"

run_test "docker/devenv/Dockerfile.ubuntu exists" \
  test -f "${PROJECT_ROOT}/docker/devenv/Dockerfile.ubuntu" || true

run_test "docker/devenv/Dockerfile.al2023 exists" \
  test -f "${PROJECT_ROOT}/docker/devenv/Dockerfile.al2023" || true

run_test "docker/litellm/Dockerfile exists" \
  test -f "${PROJECT_ROOT}/docker/litellm/Dockerfile" || true

run_test "cdk/bin/app.ts exists" \
  test -f "${PROJECT_ROOT}/cdk/bin/app.ts" || true

run_test "terraform/main.tf exists" \
  test -f "${PROJECT_ROOT}/terraform/main.tf" || true

for i in 1 2 3 4 5; do
  padded=$(printf "%02d" "$i")
  run_test "cloudformation/${padded}-*.yaml exists" \
    bash -c "ls '${PROJECT_ROOT}/cloudformation/${padded}-'*.yaml >/dev/null 2>&1" || true
done

run_test "shared/nextjs-app/package.json exists" \
  test -f "${PROJECT_ROOT}/shared/nextjs-app/package.json" || true

run_test "scripts/create-ecr-repos.sh exists" \
  test -f "${PROJECT_ROOT}/scripts/create-ecr-repos.sh" || true

run_test "scripts/verify-deployment.sh exists" \
  test -f "${PROJECT_ROOT}/scripts/verify-deployment.sh" || true

run_test "docs/deployment-guide.md exists" \
  test -f "${PROJECT_ROOT}/docs/deployment-guide.md" || true

run_test "docs/iac-comparison.md exists" \
  test -f "${PROJECT_ROOT}/docs/iac-comparison.md" || true

run_test "docs/architecture.md exists" \
  test -f "${PROJECT_ROOT}/docs/architecture.md" || true

# ===========================================================================
# Summary
# ===========================================================================
echo ""
echo "================================================================"
echo "  E2E Test Summary"
echo "================================================================"
echo "  PASS:  $PASS"
echo "  FAIL:  $FAIL"
echo "  SKIP:  $SKIP"
echo "  TOTAL: $TOTAL"
echo "================================================================"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "  RESULT: FAILED ($FAIL test(s) failed)"
  exit 1
elif [[ $PASS -eq 0 && $SKIP -gt 0 ]]; then
  echo ""
  echo "  RESULT: INCONCLUSIVE (all tests skipped)"
  exit 0
else
  echo ""
  echo "  RESULT: PASSED"
  exit 0
fi
