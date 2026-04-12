"""
AgentCore Gateway Manager Lambda
Triggered by: DynamoDB Streams on cc-dept-mcp-config table
Also supports direct invocation for create_gateway, delete_gateway, sync actions.

Manages per-department AgentCore Gateways:
  1. CREATE: Creates IAM role + Gateway + registers Lambda targets
  2. DELETE: Removes targets, deletes Gateway, cleans up IAM role
  3. SYNC: Re-syncs targets when MCP assignments change (DDB Streams)

DDB Streams events:
  - GATEWAY record INSERT → create gateway
  - MCP# record INSERT/REMOVE → add/remove target on gateway
  - GATEWAY record REMOVE → delete gateway
"""
import boto3
import json
import os
import time
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
ACCOUNT_ID = os.environ.get("ACCOUNT_ID", "")
MCP_CATALOG_TABLE = os.environ.get("MCP_CATALOG_TABLE", "cc-mcp-catalog")
DEPT_MCP_CONFIG_TABLE = os.environ.get("DEPT_MCP_CONFIG_TABLE", "cc-dept-mcp-config")
GATEWAY_ROLE_PREFIX = "cc-on-bedrock-agentcore-gateway"
PERMISSION_BOUNDARY_NAME = os.environ.get("PERMISSION_BOUNDARY_NAME", "cc-on-bedrock-task-boundary")
TRUST_POLICY = json.dumps({
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "bedrock-agentcore.amazonaws.com"},
        "Action": "sts:AssumeRole",
    }],
})

dynamodb = boto3.client("dynamodb", region_name=REGION)
iam = boto3.client("iam", region_name=REGION)
lambda_client = boto3.client("lambda", region_name=REGION)

try:
    agentcore = boto3.client("bedrock-agentcore-control", region_name=REGION)
except Exception:
    agentcore = None
    logger.warning("bedrock-agentcore-control client not available")


def get_account_id():
    global ACCOUNT_ID
    if not ACCOUNT_ID:
        ACCOUNT_ID = boto3.client("sts").get_caller_identity()["Account"]
    return ACCOUNT_ID


def update_gateway_status(department: str, status: str, extra: dict = None):
    """Update gateway status in DynamoDB."""
    update_expr = "SET #status = :status, lastSyncAt = :now"
    attr_names = {"#status": "status"}
    attr_values = {
        ":status": {"S": status},
        ":now": {"S": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
    }
    if extra:
        for k, v in extra.items():
            alias = f"#extra_{k}"
            update_expr += f", {alias} = :{k}"
            attr_names[alias] = k
            attr_values[f":{k}"] = {"S": str(v)}

    dynamodb.update_item(
        TableName=DEPT_MCP_CONFIG_TABLE,
        Key={"PK": {"S": f"DEPT#{department}"}, "SK": {"S": "GATEWAY"}},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=attr_values,
    )


def create_gateway_role(department: str) -> str:
    """Create IAM role for department gateway."""
    role_name = f"{GATEWAY_ROLE_PREFIX}-{department}"
    account_id = get_account_id()

    try:
        resp = iam.get_role(RoleName=role_name)
        logger.info(f"Role {role_name} already exists")
        return resp["Role"]["Arn"]
    except iam.exceptions.NoSuchEntityException:
        pass

    boundary_arn = f"arn:aws:iam::{account_id}:policy/{PERMISSION_BOUNDARY_NAME}"
    resp = iam.create_role(
        RoleName=role_name,
        AssumeRolePolicyDocument=TRUST_POLICY,
        PermissionsBoundary=boundary_arn,
        Description=f"AgentCore Gateway role for department: {department}",
        Tags=[
            {"Key": "project", "Value": "cc-on-bedrock"},
            {"Key": "department", "Value": department},
            {"Key": "managed-by", "Value": "gateway-manager-lambda"},
        ],
    )

    # Attach policy for Lambda invocation
    iam.put_role_policy(
        RoleName=role_name,
        PolicyName="InvokeMcpLambdas",
        PolicyDocument=json.dumps({
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Action": "lambda:InvokeFunction",
                "Resource": f"arn:aws:lambda:{REGION}:{account_id}:function:cc-on-bedrock-mcp-*",
            }],
        }),
    )

    # Wait for role propagation
    time.sleep(10)
    return resp["Role"]["Arn"]


def delete_gateway_role(department: str):
    """Delete IAM role for department gateway."""
    role_name = f"{GATEWAY_ROLE_PREFIX}-{department}"
    try:
        # Remove inline policies
        policies = iam.list_role_policies(RoleName=role_name)
        for policy_name in policies.get("PolicyNames", []):
            iam.delete_role_policy(RoleName=role_name, PolicyName=policy_name)
        iam.delete_role(RoleName=role_name)
        logger.info(f"Deleted role {role_name}")
    except iam.exceptions.NoSuchEntityException:
        logger.info(f"Role {role_name} already deleted")


def get_mcp_lambda_arn(mcp_id: str) -> str:
    """Look up Lambda ARN from catalog."""
    result = dynamodb.get_item(
        TableName=MCP_CATALOG_TABLE,
        Key={"PK": {"S": f"MCP#{mcp_id}"}, "SK": {"S": "META"}},
    )
    item = result.get("Item", {})
    arn = item.get("lambdaArn", {}).get("S", "")
    if not arn:
        account_id = get_account_id()
        arn = f"arn:aws:lambda:{REGION}:{account_id}:function:cc-on-bedrock-mcp-{mcp_id}"
    return arn


def create_gateway(department: str):
    """Create AgentCore Gateway for department with rollback on failure."""
    logger.info(f"Creating gateway for department: {department}")
    update_gateway_status(department, "CREATING")

    role_arn = None
    gateway_id = None

    try:
        role_arn = create_gateway_role(department)
        gateway_name = f"cc-{department}-mcp-gateway"

        if not agentcore:
            logger.error("AgentCore client not available")
            update_gateway_status(department, "ERROR", {"error": "AgentCore client unavailable"})
            return

        # Create gateway
        resp = agentcore.create_gateway(
            name=gateway_name,
            protocolType="MCP",
            roleArn=role_arn,
            description=f"MCP Gateway for {department} department",
        )

        gateway_id = resp.get("gatewayId", "")
        logger.info(f"Gateway created: {gateway_id}")

        # Wait for gateway to be active
        gw_status = "UNKNOWN"
        for _ in range(30):
            gw = agentcore.get_gateway(gatewayId=gateway_id)
            gw_status = gw.get("status", "UNKNOWN")
            if gw_status == "ACTIVE":
                break
            time.sleep(2)

        if gw_status != "ACTIVE":
            update_gateway_status(department, "ERROR", {
                "gatewayId": gateway_id,
                "error": f"Gateway did not reach ACTIVE, final status: {gw_status}",
            })
            raise RuntimeError(f"Gateway {gateway_id} stuck in {gw_status}")

        gateway_url = gw.get("gatewayUrl", "")

        # Register Lambda targets for assigned MCPs
        assigned_mcps = get_assigned_mcps(department)
        for mcp_id in assigned_mcps:
            register_target(gateway_id, mcp_id)

        update_gateway_status(department, "ACTIVE", {
            "gatewayId": gateway_id,
            "gatewayUrl": gateway_url,
            "roleArn": role_arn,
        })

        logger.info(f"Gateway {gateway_id} active with {len(assigned_mcps)} targets")

    except Exception as e:
        logger.error(f"Gateway creation failed: {e}")
        # Compensating transaction: rollback completed steps
        if gateway_id and agentcore:
            try:
                agentcore.delete_gateway(gatewayId=gateway_id)
                logger.info(f"Rollback: deleted gateway {gateway_id}")
            except Exception as rollback_err:
                logger.error(f"Rollback gateway delete failed: {rollback_err}")
        if role_arn:
            try:
                delete_gateway_role(department)
                logger.info(f"Rollback: deleted IAM role for {department}")
            except Exception as rollback_err:
                logger.error(f"Rollback role delete failed: {rollback_err}")
        update_gateway_status(department, "ERROR", {"error": str(e)})
        raise


def delete_gateway(department: str):
    """Delete AgentCore Gateway for department with step tracking."""
    logger.info(f"Deleting gateway for department: {department}")
    completed_steps = []

    try:
        # Get gateway ID from DDB
        result = dynamodb.get_item(
            TableName=DEPT_MCP_CONFIG_TABLE,
            Key={"PK": {"S": f"DEPT#{department}"}, "SK": {"S": "GATEWAY"}},
        )
        item = result.get("Item", {})
        gateway_id = item.get("gatewayId", {}).get("S", "")

        if gateway_id and agentcore:
            # Remove all targets first
            try:
                targets = agentcore.list_gateway_targets(gatewayId=gateway_id)
                for target in targets.get("targets", []):
                    agentcore.delete_gateway_target(
                        gatewayId=gateway_id,
                        targetId=target["targetId"],
                    )
                completed_steps.append("targets_removed")
            except Exception as e:
                logger.warning(f"Error removing targets: {e}")

            # Delete gateway
            agentcore.delete_gateway(gatewayId=gateway_id)
            completed_steps.append("gateway_deleted")
            logger.info(f"Gateway {gateway_id} deleted")

        # Clean up IAM role
        delete_gateway_role(department)
        completed_steps.append("role_deleted")

        # Remove DDB record
        dynamodb.delete_item(
            TableName=DEPT_MCP_CONFIG_TABLE,
            Key={"PK": {"S": f"DEPT#{department}"}, "SK": {"S": "GATEWAY"}},
        )
        completed_steps.append("ddb_cleaned")

        logger.info(f"Gateway cleanup complete for {department}")

    except Exception as e:
        logger.error(f"Gateway deletion failed at steps={completed_steps}: {e}")
        update_gateway_status(department, "DELETE_FAILED", {
            "error": str(e),
            "completedSteps": ",".join(completed_steps),
        })
        raise


def get_assigned_mcps(department: str) -> list:
    """Get list of assigned MCP IDs for department."""
    result = dynamodb.query(
        TableName=DEPT_MCP_CONFIG_TABLE,
        KeyConditionExpression="PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues={
            ":pk": {"S": f"DEPT#{department}"},
            ":prefix": {"S": "MCP#"},
        },
    )
    return [
        item["SK"]["S"].replace("MCP#", "")
        for item in result.get("Items", [])
        if item.get("enabled", {}).get("BOOL", True)
    ]


def register_target(gateway_id: str, mcp_id: str):
    """Register a Lambda MCP target on gateway."""
    if not agentcore:
        logger.warning("AgentCore client not available, skipping target registration")
        return

    lambda_arn = get_mcp_lambda_arn(mcp_id)
    logger.info(f"Registering target {mcp_id} (lambda={lambda_arn}) on gateway {gateway_id}")

    try:
        agentcore.create_gateway_target(
            gatewayId=gateway_id,
            name=mcp_id,
            targetConfiguration={
                "lambdaTargetConfiguration": {
                    "lambdaArn": lambda_arn,
                }
            },
            description=f"MCP target: {mcp_id}",
        )
    except Exception as e:
        if "already exists" in str(e).lower() or "conflict" in str(e).lower():
            logger.info(f"Target {mcp_id} already exists on gateway")
        else:
            raise


def remove_target(gateway_id: str, mcp_id: str):
    """Remove a Lambda MCP target from gateway."""
    if not agentcore:
        return

    try:
        targets = agentcore.list_gateway_targets(gatewayId=gateway_id)
        for target in targets.get("targets", []):
            if target.get("name") == mcp_id:
                agentcore.delete_gateway_target(
                    gatewayId=gateway_id,
                    targetId=target["targetId"],
                )
                logger.info(f"Removed target {mcp_id} from gateway {gateway_id}")
                return
    except Exception as e:
        logger.warning(f"Error removing target {mcp_id}: {e}")


def handle_stream_event(record: dict):
    """Process a single DynamoDB Streams record."""
    event_name = record.get("eventName", "")
    new_image = record.get("dynamodb", {}).get("NewImage", {})
    old_image = record.get("dynamodb", {}).get("OldImage", {})
    image = new_image or old_image

    pk = image.get("PK", {}).get("S", "")
    sk = image.get("SK", {}).get("S", "")

    if not pk.startswith("DEPT#"):
        return

    department = pk.replace("DEPT#", "")

    if sk == "GATEWAY":
        if event_name == "INSERT":
            status = new_image.get("status", {}).get("S", "")
            if status in ("PENDING", "CREATING"):
                create_gateway(department)
        elif event_name == "MODIFY":
            status = new_image.get("status", {}).get("S", "")
            if status == "DELETING":
                delete_gateway(department)
        elif event_name == "REMOVE":
            delete_gateway(department)

    elif sk.startswith("MCP#"):
        mcp_id = sk.replace("MCP#", "")
        # Get gateway ID for this department
        gw_result = dynamodb.get_item(
            TableName=DEPT_MCP_CONFIG_TABLE,
            Key={"PK": {"S": f"DEPT#{department}"}, "SK": {"S": "GATEWAY"}},
        )
        gw_item = gw_result.get("Item", {})
        gateway_id = gw_item.get("gatewayId", {}).get("S", "")

        if not gateway_id:
            logger.warning(f"No gateway found for {department}, skipping target update")
            return

        if event_name in ("INSERT", "MODIFY"):
            enabled = new_image.get("enabled", {}).get("BOOL", True)
            if enabled:
                register_target(gateway_id, mcp_id)
            else:
                remove_target(gateway_id, mcp_id)
        elif event_name == "REMOVE":
            remove_target(gateway_id, mcp_id)

        update_gateway_status(department, "ACTIVE")


def lambda_handler(event, context):
    """Main Lambda handler — supports DDB Streams and direct invocation."""
    logger.info(f"Event: {json.dumps(event)[:500]}")

    # Direct invocation
    if "action" in event:
        action = event["action"]
        department = event.get("department", "")

        if action == "create_gateway" and department:
            create_gateway(department)
        elif action == "delete_gateway" and department:
            delete_gateway(department)
        elif action == "sync_gateway" and department:
            # Re-sync all targets for department
            gw_result = dynamodb.get_item(
                TableName=DEPT_MCP_CONFIG_TABLE,
                Key={"PK": {"S": f"DEPT#{department}"}, "SK": {"S": "GATEWAY"}},
            )
            gw_item = gw_result.get("Item", {})
            gateway_id = gw_item.get("gatewayId", {}).get("S", "")
            if gateway_id:
                assigned = get_assigned_mcps(department)
                for mcp_id in assigned:
                    register_target(gateway_id, mcp_id)
                update_gateway_status(department, "ACTIVE")
        else:
            logger.error(f"Unknown action: {action}")

        return {"statusCode": 200, "body": json.dumps({"action": action, "department": department})}

    # DDB Streams events
    records = event.get("Records", [])
    failed_ids = []

    for record in records:
        try:
            handle_stream_event(record)
        except Exception as e:
            logger.error(f"Stream event failed: {e}")
            event_id = record.get("eventID", "unknown")
            failed_ids.append({"itemIdentifier": event_id})

    # Return failed items for partial batch failure
    if failed_ids:
        return {"batchItemFailures": failed_ids}

    return {"statusCode": 200, "body": json.dumps({"processed": len(records)})}
