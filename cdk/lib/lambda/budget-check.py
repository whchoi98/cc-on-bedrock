"""
Budget Check Lambda (runs every 5 minutes)
Checks DynamoDB for users exceeding daily budget.
Actions: 1) SNS alert at 80%, 2) ECS StopTask + Cognito flag at 100%
"""
import os
import json
import boto3
from datetime import datetime

TABLE_NAME = os.environ.get("USAGE_TABLE_NAME", "cc-on-bedrock-usage")
ECS_CLUSTER = os.environ.get("ECS_CLUSTER_NAME", "cc-on-bedrock-devenv")
DAILY_BUDGET = float(os.environ.get("DAILY_BUDGET_USD", "50"))
USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
ecs_client = boto3.client("ecs")
cognito_client = boto3.client("cognito-idp")
sns_client = boto3.client("sns")


def get_today_usage():
    """Scan DynamoDB for all USER# entries today."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    result = table.scan(
        FilterExpression="begins_with(PK, :prefix) AND begins_with(SK, :today)",
        ExpressionAttributeValues={":prefix": "USER#", ":today": today},
    )
    user_spend = {}
    for item in result.get("Items", []):
        user = item["PK"].replace("USER#", "")
        cost = float(item.get("estimatedCost", 0))
        dept = item.get("department", "default")
        if user in user_spend:
            user_spend[user]["cost"] += cost
        else:
            user_spend[user] = {"cost": cost, "department": dept}
    return user_spend


def stop_user_container(username: str):
    """Find and stop the user's ECS task."""
    try:
        task_arns = ecs_client.list_tasks(cluster=ECS_CLUSTER)["taskArns"]
        if not task_arns:
            return
        tasks = ecs_client.describe_tasks(
            cluster=ECS_CLUSTER, tasks=task_arns, include=["TAGS"]
        )["tasks"]
        for task in tasks:
            tags = {t["key"]: t["value"] for t in task.get("tags", [])}
            if tags.get("username") == username and task.get("lastStatus") == "RUNNING":
                ecs_client.stop_task(
                    cluster=ECS_CLUSTER,
                    task=task["taskArn"],
                    reason=f"Daily budget exceeded (${DAILY_BUDGET})",
                )
                print(f"Stopped task for {username}: {task['taskArn']}")
    except Exception as e:
        print(f"Failed to stop container for {username}: {e}")


def set_cognito_budget_flag(username: str, exceeded: bool):
    """Set budget_exceeded flag in Cognito user attributes."""
    if not USER_POOL_ID:
        return
    try:
        # Find user by username (which is the subdomain)
        result = cognito_client.list_users(
            UserPoolId=USER_POOL_ID,
            Filter=f'custom:subdomain = "{username}"',
            Limit=1,
        )
        users = result.get("Users", [])
        if users:
            cognito_client.admin_update_user_attributes(
                UserPoolId=USER_POOL_ID,
                Username=users[0]["Username"],
                UserAttributes=[
                    {"Name": "custom:budget_exceeded", "Value": str(exceeded).lower()},
                ],
            )
            print(f"Cognito flag set for {username}: budget_exceeded={exceeded}")
    except Exception as e:
        print(f"Cognito update failed for {username}: {e}")


def handler(event, context):
    """Check budgets and enforce limits."""
    user_spend = get_today_usage()
    over_budget = []
    warnings = []

    for user, data in user_spend.items():
        pct = (data["cost"] / DAILY_BUDGET) * 100 if DAILY_BUDGET > 0 else 0

        if pct >= 100:
            over_budget.append({
                "user": user, "cost": data["cost"],
                "department": data["department"], "pct": pct,
            })
        elif pct >= 80:
            warnings.append({
                "user": user, "cost": data["cost"],
                "department": data["department"], "pct": pct,
            })

    # 80%: Send warning alert
    if warnings and SNS_TOPIC_ARN:
        msg = f"CC-on-Bedrock Budget Warnings (daily limit: ${DAILY_BUDGET}):\n\n"
        msg += "\n".join(
            f"- {w['user']} ({w['department']}): ${w['cost']:.4f} ({w['pct']:.1f}%)"
            for w in warnings
        )
        try:
            sns_client.publish(
                TopicArn=SNS_TOPIC_ARN,
                Subject="[CC-on-Bedrock] Budget Warning",
                Message=msg,
            )
        except Exception as e:
            print(f"SNS warning failed: {e}")

    # 100%: Stop container + set Cognito flag + alert
    for item in over_budget:
        print(f"OVER BUDGET: {item['user']} ({item['department']}) "
              f"${item['cost']:.4f} ({item['pct']:.1f}%)")
        stop_user_container(item["user"])
        set_cognito_budget_flag(item["user"], True)

    if over_budget and SNS_TOPIC_ARN:
        msg = f"CC-on-Bedrock Budget EXCEEDED - Containers Stopped:\n\n"
        msg += "\n".join(
            f"- {o['user']} ({o['department']}): ${o['cost']:.4f} "
            f"({o['pct']:.1f}% of ${DAILY_BUDGET})"
            for o in over_budget
        )
        try:
            sns_client.publish(
                TopicArn=SNS_TOPIC_ARN,
                Subject="[CC-on-Bedrock] Budget Exceeded - Action Taken",
                Message=msg,
            )
        except Exception as e:
            print(f"SNS alert failed: {e}")

    return {
        "checked": len(user_spend),
        "over_budget": len(over_budget),
        "warnings": len(warnings),
        "daily_budget_usd": DAILY_BUDGET,
        "timestamp": datetime.utcnow().isoformat(),
    }
