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
STACK_PREFIX="CcOnBedrock"

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

# Get Dashboard URL from stack output (handles custom domain prefixes)
DASHBOARD_URL=$(get_cfn_output "${STACK_PREFIX}-Dashboard" "DashboardUrl")
DASHBOARD_CF=$(get_cfn_output "${STACK_PREFIX}-Dashboard" "CloudFrontDomain")
if [[ -z "$DASHBOARD_URL" || "$DASHBOARD_URL" == "None" ]]; then
  DASHBOARD_URL="https://dashboard.${DOMAIN}"
fi

check "Dashboard CloudFront (${DASHBOARD_CF:-direct})"
DASHBOARD_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${DASHBOARD_CF:-dashboard.${DOMAIN}}" 2>/dev/null || echo "000")
if [[ "$DASHBOARD_HTTP" =~ ^(200|301|302|307|401|403)$ ]]; then
  pass "HTTP $DASHBOARD_HTTP"
elif [[ "$DASHBOARD_HTTP" == "000" ]]; then
  warn "connection failed - CloudFront may not be reachable"
else
  fail "HTTP $DASHBOARD_HTTP - expected 200/301/302/307/401/403"
fi

# Get DevEnv CloudFront
DEVENV_CF=$(get_cfn_output "${STACK_PREFIX}-EcsDevenv" "CloudFrontDomain")
check "Dev Env CloudFront (${DEVENV_CF:-*.dev.${DOMAIN}})"
DEV_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${DEVENV_CF:-test.dev.${DOMAIN}}" 2>/dev/null || echo "000")
if [[ "$DEV_HTTP" =~ ^(200|301|302|307|401|403|502|503|504)$ ]]; then
  pass "HTTP $DEV_HTTP (CloudFront reachable - 502/503/504 expected if no ECS tasks running)"
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
HEALTH_RESPONSE=$(curl -sf --max-time 10 "https://${DASHBOARD_CF:-dashboard.${DOMAIN}}/api/health" 2>/dev/null || echo "")
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
USER_POOL_ID=$(get_cfn_output "${STACK_PREFIX}-Security" "UserPoolId")
if [[ -z "$USER_POOL_ID" || "$USER_POOL_ID" == "None" ]]; then
  # Try describing user pools directly
  USER_POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region "$REGION" \
    --query "UserPools[?contains(Name, 'cc-on-bedrock')].Id | [0]" --output text 2>/dev/null || echo "")
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
CLUSTER_NAME=$(get_cfn_output "${STACK_PREFIX}-EcsDevenv" "ClusterName")
if [[ -z "$CLUSTER_NAME" || "$CLUSTER_NAME" == "None" ]]; then
  # Fallback: search by known name
  CLUSTER_NAME="cc-on-bedrock-devenv"
fi
CLUSTER_INFO=$(aws ecs describe-clusters --clusters "$CLUSTER_NAME" --region "$REGION" \
  --query "clusters[0].{Status:status,Instances:registeredContainerInstancesCount,Running:runningTasksCount}" \
  --output json 2>/dev/null || echo "{}")
CLUSTER_STATUS=$(echo "$CLUSTER_INFO" | jq -r '.Status // "NOT_FOUND"')
CLUSTER_INSTANCES=$(echo "$CLUSTER_INFO" | jq -r '.Instances // 0')
if [[ "$CLUSTER_STATUS" == "ACTIVE" ]]; then
  pass "cluster=$CLUSTER_NAME instances=$CLUSTER_INSTANCES"
else
  fail "cluster=$CLUSTER_NAME status=$CLUSTER_STATUS"
fi

check "ECS task definitions registered"
TASK_DEF_COUNT=0
for PREFIX in devenv-ubuntu-light devenv-ubuntu-standard devenv-ubuntu-power devenv-al2023-light devenv-al2023-standard devenv-al2023-power; do
  TD=$(aws ecs list-task-definitions --family-prefix "$PREFIX" --region "$REGION" \
    --query "length(taskDefinitionArns)" --output text 2>/dev/null || echo "0")
  TASK_DEF_COUNT=$((TASK_DEF_COUNT + TD))
done
if [[ "$TASK_DEF_COUNT" -gt 0 ]]; then
  pass "$TASK_DEF_COUNT task definition(s) across 6 families"
else
  warn "no task definitions found"
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
  --query "FileSystems[?contains(Name, 'cc-on-bedrock') || contains(Name, 'CcOnBedrock') || contains(Name, 'devenv') || contains(Name, 'Devenv')].FileSystemId" \
  --output text 2>/dev/null || echo "")
if [[ -n "$EFS_IDS" ]]; then
  pass "IDs: $EFS_IDS"
else
  # Fallback: check all EFS and look for tags
  EFS_IDS=$(aws efs describe-file-systems --region "$REGION" \
    --query "FileSystems[].FileSystemId" --output text 2>/dev/null || echo "")
  if [[ -n "$EFS_IDS" ]]; then
    warn "found EFS ($EFS_IDS) but could not confirm by name"
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
  --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'Litellm') || contains(AutoScalingGroupName, 'LiteLLM') || contains(AutoScalingGroupName, 'litellm')].{Name:AutoScalingGroupName,Desired:DesiredCapacity,Running:length(Instances[?LifecycleState=='InService'])}" \
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
LITELLM_ALB_DNS=$(get_cfn_output "${STACK_PREFIX}-LiteLLM" "InternalAlbDns")
if [[ -n "$LITELLM_ALB_DNS" && "$LITELLM_ALB_DNS" != "None" ]]; then
  # Internal ALB - check target health via AWS API
  LITELLM_TG=$(aws elbv2 describe-target-groups --region "$REGION" \
    --query "TargetGroups[?contains(TargetGroupName, 'Litel') || contains(TargetGroupName, 'litel')].TargetGroupArn | [0]" \
    --output text 2>/dev/null || echo "")
  if [[ -n "$LITELLM_TG" && "$LITELLM_TG" != "None" ]]; then
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

check "LiteLLM readiness (cache + db)"
if [[ -n "$LITELLM_ASG" && "$LITELLM_ASG" != "[]" ]]; then
  LITELLM_INSTANCE=$(echo "$LITELLM_ASG" | jq -r '.[0].Name' | xargs -I{} aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names {} --region "$REGION" --query "AutoScalingGroups[0].Instances[?LifecycleState=='InService'].InstanceId | [0]" --output text 2>/dev/null || echo "")
  if [[ -n "$LITELLM_INSTANCE" && "$LITELLM_INSTANCE" != "None" ]]; then
    CMD_ID=$(aws ssm send-command --instance-ids "$LITELLM_INSTANCE" --document-name "AWS-RunShellScript" \
      --parameters '{"commands":["curl -sf http://localhost:4000/health/readiness 2>/dev/null || echo FAILED"]}' \
      --region "$REGION" --output text --query 'Command.CommandId' 2>/dev/null || echo "")
    if [[ -n "$CMD_ID" ]]; then
      sleep 5
      READINESS=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$LITELLM_INSTANCE" \
        --region "$REGION" --query 'StandardOutputContent' --output text 2>/dev/null || echo "FAILED")
      CACHE_STATUS=$(echo "$READINESS" | jq -r '.cache // "none"' 2>/dev/null || echo "unknown")
      DB_STATUS=$(echo "$READINESS" | jq -r '.db // "unknown"' 2>/dev/null || echo "unknown")
      if [[ "$CACHE_STATUS" == "redis" && "$DB_STATUS" == "connected" ]]; then
        pass "cache=$CACHE_STATUS db=$DB_STATUS"
      elif [[ "$DB_STATUS" == "connected" ]]; then
        warn "db=$DB_STATUS cache=$CACHE_STATUS"
      else
        fail "db=$DB_STATUS cache=$CACHE_STATUS"
      fi
    else
      warn "SSM command failed"
    fi
  else
    warn "no LiteLLM instance found for readiness check"
  fi
else
  warn "skipped (no ASG)"
fi

echo ""

# ===========================================================================
# 9. Valkey Cache
# ===========================================================================
echo "[Valkey Cache]"

check "Serverless Valkey cache exists"
VALKEY_STATUS=$(aws elasticache describe-serverless-caches --serverless-cache-name cc-on-bedrock-valkey --region "$REGION" \
  --query "ServerlessCaches[0].Status" --output text 2>/dev/null || echo "NOT_FOUND")
if [[ "$VALKEY_STATUS" == "available" ]]; then
  VALKEY_ENDPOINT=$(aws elasticache describe-serverless-caches --serverless-cache-name cc-on-bedrock-valkey --region "$REGION" \
    --query "ServerlessCaches[0].Endpoint.Address" --output text 2>/dev/null || echo "")
  pass "status=$VALKEY_STATUS endpoint=$VALKEY_ENDPOINT"
elif [[ "$VALKEY_STATUS" == "creating" ]]; then
  warn "status=$VALKEY_STATUS (still provisioning)"
else
  fail "status=$VALKEY_STATUS"
fi

echo ""

# ===========================================================================
# 10. Dashboard ASG
# ===========================================================================
echo "[Dashboard]"

check "Dashboard ASG instances running"
DASHBOARD_ASG=$(aws autoscaling describe-auto-scaling-groups --region "$REGION" \
  --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'Dashboard') || contains(AutoScalingGroupName, 'dashboard')].{Name:AutoScalingGroupName,Desired:DesiredCapacity,Running:length(Instances[?LifecycleState=='InService'])}" \
  --output json 2>/dev/null || echo "[]")
if [[ "$DASHBOARD_ASG" != "[]" ]]; then
  RUNNING=$(echo "$DASHBOARD_ASG" | jq -r '.[0].Running // 0')
  DESIRED=$(echo "$DASHBOARD_ASG" | jq -r '.[0].Desired // 0')
  if [[ "$RUNNING" -gt 0 ]]; then
    pass "$RUNNING/$DESIRED instances InService"
  else
    fail "0/$DESIRED instances InService"
  fi
else
  warn "Dashboard ASG not found"
fi

check "Dashboard ALB target health"
DASHBOARD_TG=$(aws elbv2 describe-target-groups --region "$REGION" \
  --query "TargetGroups[?contains(TargetGroupName, 'CcOnBe-Dashb') || contains(TargetGroupName, 'dashboard')].TargetGroupArn | [0]" \
  --output text 2>/dev/null || echo "")
if [[ -n "$DASHBOARD_TG" && "$DASHBOARD_TG" != "None" ]]; then
  HEALTHY=$(aws elbv2 describe-target-health --target-group-arn "$DASHBOARD_TG" --region "$REGION" \
    --query "length(TargetHealthDescriptions[?TargetHealth.State=='healthy'])" --output text 2>/dev/null || echo "0")
  TOTAL_TARGETS=$(aws elbv2 describe-target-health --target-group-arn "$DASHBOARD_TG" --region "$REGION" \
    --query "length(TargetHealthDescriptions)" --output text 2>/dev/null || echo "0")
  if [[ "$HEALTHY" -gt 0 ]]; then
    pass "$HEALTHY/$TOTAL_TARGETS targets healthy"
  else
    fail "0/$TOTAL_TARGETS targets healthy"
  fi
else
  warn "Dashboard target group not found"
fi

echo ""

# ===========================================================================
# 11. Secrets Manager
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
