#!/usr/bin/env bash
###############################################################################
# verify-deployment.sh - Verify that all CC-on-Bedrock services are operational
#
# Usage:
#   ./verify-deployment.sh <domain-name>
#   ./verify-deployment.sh example.com
#   ./verify-deployment.sh example.com --region ap-northeast-2
###############################################################################
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <domain-name> [--region <region>]"
  echo "Example: $0 example.com --region ap-northeast-2"
  exit 1
fi

DOMAIN="$1"
shift
REGION="${AWS_DEFAULT_REGION:-ap-northeast-2}"
STACK_PREFIX="cc-on-bedrock"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    *)        echo "Unknown option: $1"; exit 1 ;;
  esac
done

PASS=0
FAIL=0
WARN=0
TOTAL=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
check() {
  local name="$1"
  TOTAL=$((TOTAL + 1))
  echo -n "  [$TOTAL] $name: "
}

pass() {
  echo "PASS${1:+ ($1)}"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL${1:+ ($1)}"
  FAIL=$((FAIL + 1))
}

warn() {
  echo "WARN${1:+ ($1)}"
  WARN=$((WARN + 1))
}

get_cfn_output() {
  local stack_name="$1"
  local output_key="$2"
  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey==\`${output_key}\`].OutputValue" \
    --output text \
    --region "$REGION" 2>/dev/null || echo ""
}

echo "============================================================"
echo "  CC-on-Bedrock Deployment Verification"
echo "  Domain: ${DOMAIN}"
echo "  Region: ${REGION}"
echo "============================================================"
echo ""

# ===========================================================================
# 1. CloudFront Distribution Checks
# ===========================================================================
echo "[CloudFront Distributions]"

check "Dashboard CloudFront (dashboard.${DOMAIN})"
DASHBOARD_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://dashboard.${DOMAIN}" 2>/dev/null || echo "000")
if [[ "$DASHBOARD_HTTP" =~ ^(200|301|302|401|403)$ ]]; then
  pass "HTTP $DASHBOARD_HTTP"
else
  fail "HTTP $DASHBOARD_HTTP - expected 200/301/302/401/403"
fi

check "Dev Env CloudFront (*.dev.${DOMAIN}) - wildcard DNS"
DEV_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://test.dev.${DOMAIN}" 2>/dev/null || echo "000")
if [[ "$DEV_HTTP" =~ ^(200|301|302|401|403|502|503)$ ]]; then
  pass "HTTP $DEV_HTTP (response received - DNS and CloudFront working)"
elif [[ "$DEV_HTTP" == "000" ]]; then
  warn "connection failed - DNS may not be propagated yet"
else
  fail "HTTP $DEV_HTTP"
fi

echo ""

# ===========================================================================
# 2. Dashboard Health Check
# ===========================================================================
echo "[Dashboard Health]"

check "Dashboard health endpoint (/api/health)"
HEALTH_RESPONSE=$(curl -sf --max-time 10 "https://dashboard.${DOMAIN}/api/health" 2>/dev/null || echo "")
if [[ -n "$HEALTH_RESPONSE" ]]; then
  STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status // empty' 2>/dev/null || echo "")
  if [[ "$STATUS" == "ok" || "$STATUS" == "healthy" ]]; then
    pass "status=$STATUS"
  elif [[ -n "$STATUS" ]]; then
    warn "status=$STATUS"
  else
    pass "endpoint reachable"
  fi
else
  fail "no response from /api/health"
fi

echo ""

# ===========================================================================
# 3. Cognito User Pool
# ===========================================================================
echo "[Cognito]"

check "Cognito User Pool exists"
USER_POOL_ID=$(get_cfn_output "${STACK_PREFIX}-security" "UserPoolId")
if [[ -z "$USER_POOL_ID" || "$USER_POOL_ID" == "None" ]]; then
  # Try describing user pools directly
  USER_POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region "$REGION" \
    --query "UserPools[?contains(Name, 'cc-on-bedrock')].Id" --output text 2>/dev/null || echo "")
fi
if [[ -n "$USER_POOL_ID" && "$USER_POOL_ID" != "None" ]]; then
  POOL_STATUS=$(aws cognito-idp describe-user-pool --user-pool-id "$USER_POOL_ID" --region "$REGION" \
    --query "UserPool.Status" --output text 2>/dev/null || echo "UNKNOWN")
  if [[ "$POOL_STATUS" == "Enabled" || "$POOL_STATUS" == "None" ]]; then
    pass "ID=$USER_POOL_ID"
  else
    warn "ID=$USER_POOL_ID status=$POOL_STATUS"
  fi
else
  fail "User Pool not found"
fi

check "Cognito User Pool has admin group"
if [[ -n "$USER_POOL_ID" && "$USER_POOL_ID" != "None" ]]; then
  ADMIN_GROUP=$(aws cognito-idp get-group --group-name admin --user-pool-id "$USER_POOL_ID" --region "$REGION" \
    --query "Group.GroupName" --output text 2>/dev/null || echo "")
  if [[ "$ADMIN_GROUP" == "admin" ]]; then
    pass
  else
    warn "admin group not found - may need to be created"
  fi
else
  fail "skipped (no user pool)"
fi

echo ""

# ===========================================================================
# 4. ECS Cluster
# ===========================================================================
echo "[ECS Cluster]"

check "ECS cluster exists and is ACTIVE"
CLUSTER_NAME=$(get_cfn_output "${STACK_PREFIX}-ecs-devenv" "ClusterName")
if [[ -z "$CLUSTER_NAME" || "$CLUSTER_NAME" == "None" ]]; then
  CLUSTER_NAME="cc-on-bedrock"
fi
CLUSTER_STATUS=$(aws ecs describe-clusters --clusters "$CLUSTER_NAME" --region "$REGION" \
  --query "clusters[0].status" --output text 2>/dev/null || echo "NOT_FOUND")
if [[ "$CLUSTER_STATUS" == "ACTIVE" ]]; then
  pass "cluster=$CLUSTER_NAME"
else
  fail "cluster=$CLUSTER_NAME status=$CLUSTER_STATUS"
fi

check "ECS task definitions registered"
TASK_DEFS=$(aws ecs list-task-definitions --family-prefix devenv --region "$REGION" \
  --query "taskDefinitionArns" --output text 2>/dev/null || echo "")
if [[ -n "$TASK_DEFS" ]]; then
  COUNT=$(echo "$TASK_DEFS" | wc -w)
  pass "$COUNT task definition(s) found"
else
  warn "no task definitions found with prefix 'devenv'"
fi

echo ""

# ===========================================================================
# 5. RDS Instance
# ===========================================================================
echo "[RDS]"

check "RDS PostgreSQL instance is available"
RDS_STATUS=$(aws rds describe-db-instances \
  --query "DBInstances[?contains(DBInstanceIdentifier, 'cc-on-bedrock') || contains(DBInstanceIdentifier, 'litellm')].DBInstanceStatus" \
  --output text --region "$REGION" 2>/dev/null || echo "NOT_FOUND")
if [[ "$RDS_STATUS" == "available" ]]; then
  pass
elif [[ "$RDS_STATUS" == "creating" || "$RDS_STATUS" == "backing-up" || "$RDS_STATUS" == "modifying" ]]; then
  warn "status=$RDS_STATUS (still provisioning)"
else
  fail "status=$RDS_STATUS"
fi

echo ""

# ===========================================================================
# 6. EFS File System
# ===========================================================================
echo "[EFS]"

check "EFS file system exists"
EFS_IDS=$(aws efs describe-file-systems --region "$REGION" \
  --query "FileSystems[?contains(Name, 'cc-on-bedrock') || contains(Name, 'devenv')].FileSystemId" \
  --output text 2>/dev/null || echo "")
if [[ -n "$EFS_IDS" ]]; then
  pass "IDs: $EFS_IDS"
else
  # Try by tag
  EFS_IDS=$(aws efs describe-file-systems --region "$REGION" \
    --query "FileSystems[].FileSystemId" --output text 2>/dev/null || echo "")
  if [[ -n "$EFS_IDS" ]]; then
    warn "found EFS file systems but could not confirm cc-on-bedrock by name"
  else
    fail "no EFS file systems found"
  fi
fi

echo ""

# ===========================================================================
# 7. ECR Repositories
# ===========================================================================
echo "[ECR Repositories]"

for REPO in "cc-on-bedrock/litellm" "cc-on-bedrock/devenv"; do
  check "ECR repo '$REPO' exists"
  REPO_URI=$(aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" \
    --query "repositories[0].repositoryUri" --output text 2>/dev/null || echo "")
  if [[ -n "$REPO_URI" && "$REPO_URI" != "None" ]]; then
    pass "$REPO_URI"
  else
    fail "repository not found"
  fi
done

check "ECR repo 'cc-on-bedrock/litellm' has images"
IMAGE_COUNT=$(aws ecr describe-images --repository-name "cc-on-bedrock/litellm" --region "$REGION" \
  --query "length(imageDetails)" --output text 2>/dev/null || echo "0")
if [[ "$IMAGE_COUNT" -gt 0 ]]; then
  pass "$IMAGE_COUNT image(s)"
else
  warn "no images pushed yet"
fi

check "ECR repo 'cc-on-bedrock/devenv' has images"
IMAGE_COUNT=$(aws ecr describe-images --repository-name "cc-on-bedrock/devenv" --region "$REGION" \
  --query "length(imageDetails)" --output text 2>/dev/null || echo "0")
if [[ "$IMAGE_COUNT" -gt 0 ]]; then
  pass "$IMAGE_COUNT image(s)"
else
  warn "no images pushed yet"
fi

echo ""

# ===========================================================================
# 8. LiteLLM Health (Internal - via SSM or skip)
# ===========================================================================
echo "[LiteLLM Proxy]"

check "LiteLLM ASG instances running"
LITELLM_ASG=$(aws autoscaling describe-auto-scaling-groups --region "$REGION" \
  --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'litellm') || contains(AutoScalingGroupName, 'LiteLLM')].{Name:AutoScalingGroupName,Desired:DesiredCapacity,Running:length(Instances[?LifecycleState=='InService'])}" \
  --output json 2>/dev/null || echo "[]")
if [[ "$LITELLM_ASG" != "[]" ]]; then
  RUNNING=$(echo "$LITELLM_ASG" | jq -r '.[0].Running // 0')
  DESIRED=$(echo "$LITELLM_ASG" | jq -r '.[0].Desired // 0')
  if [[ "$RUNNING" -gt 0 ]]; then
    pass "$RUNNING/$DESIRED instances InService"
  else
    fail "0/$DESIRED instances InService"
  fi
else
  warn "LiteLLM ASG not found by name pattern"
fi

check "LiteLLM Internal ALB health"
LITELLM_ALB_DNS=$(get_cfn_output "${STACK_PREFIX}-litellm" "InternalAlbDns")
if [[ -n "$LITELLM_ALB_DNS" && "$LITELLM_ALB_DNS" != "None" ]]; then
  # Internal ALB - check target health via AWS API
  LITELLM_TG=$(aws elbv2 describe-target-groups --region "$REGION" \
    --query "TargetGroups[?contains(TargetGroupName, 'litellm') || contains(TargetGroupName, 'LiteLLM')].TargetGroupArn" \
    --output text 2>/dev/null || echo "")
  if [[ -n "$LITELLM_TG" ]]; then
    HEALTHY=$(aws elbv2 describe-target-health --target-group-arn "$LITELLM_TG" --region "$REGION" \
      --query "length(TargetHealthDescriptions[?TargetHealth.State=='healthy'])" --output text 2>/dev/null || echo "0")
    TOTAL_TARGETS=$(aws elbv2 describe-target-health --target-group-arn "$LITELLM_TG" --region "$REGION" \
      --query "length(TargetHealthDescriptions)" --output text 2>/dev/null || echo "0")
    if [[ "$HEALTHY" -gt 0 ]]; then
      pass "$HEALTHY/$TOTAL_TARGETS targets healthy"
    else
      fail "0/$TOTAL_TARGETS targets healthy"
    fi
  else
    warn "target group not found - cannot verify health"
  fi
else
  warn "ALB DNS not available from stack outputs"
fi

echo ""

# ===========================================================================
# 9. Secrets Manager
# ===========================================================================
echo "[Secrets Manager]"

for SECRET in "cc-on-bedrock/litellm-master-key" "cc-on-bedrock/rds-credentials" "cc-on-bedrock/cloudfront-secret" "cc-on-bedrock/valkey-auth"; do
  check "Secret '$SECRET' exists"
  SECRET_ARN=$(aws secretsmanager describe-secret --secret-id "$SECRET" --region "$REGION" \
    --query "ARN" --output text 2>/dev/null || echo "")
  if [[ -n "$SECRET_ARN" && "$SECRET_ARN" != "None" ]]; then
    pass
  else
    fail "not found"
  fi
done

echo ""

# ===========================================================================
# Summary
# ===========================================================================
echo "============================================================"
echo "  Verification Summary"
echo "============================================================"
echo "  PASS: $PASS"
echo "  WARN: $WARN"
echo "  FAIL: $FAIL"
echo "  TOTAL: $TOTAL"
echo "============================================================"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "  Some checks FAILED. Review output above for details."
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo ""
  echo "  All critical checks passed. Warnings may resolve after"
  echo "  DNS propagation or image push."
  exit 0
else
  echo ""
  echo "  All checks passed. Deployment is healthy."
  exit 0
fi
