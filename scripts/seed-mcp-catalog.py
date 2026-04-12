#!/usr/bin/env python3
"""
Seed MCP Catalog for CC-on-Bedrock
Populates cc-mcp-catalog DynamoDB table with initial MCP items
and creates COMMON/GATEWAY record in cc-dept-mcp-config.

Usage:
  python3 scripts/seed-mcp-catalog.py
  python3 scripts/seed-mcp-catalog.py --dry-run
  python3 scripts/seed-mcp-catalog.py --region us-east-1
"""
import argparse
import json
import sys
from datetime import datetime

import boto3

CATALOG_TABLE = "cc-mcp-catalog"
CONFIG_TABLE = "cc-dept-mcp-config"

CATALOG_ITEMS = [
    {
        "mcpId": "ecs-mcp",
        "name": "ECS Container MCP",
        "description": "Container status, task management, cluster info",
        "category": "common",
        "tools": ["list_tasks", "describe_task", "get_cluster_info"],
    },
    {
        "mcpId": "cloudwatch-mcp",
        "name": "CloudWatch Metrics MCP",
        "description": "Container Insights, CPU/Memory metrics, log queries",
        "category": "common",
        "tools": ["get_metrics", "query_logs", "get_alarms"],
    },
    {
        "mcpId": "dynamodb-mcp",
        "name": "DynamoDB MCP",
        "description": "Usage data, budget info, routing table queries",
        "category": "common",
        "tools": ["query_usage", "get_budget", "check_health"],
    },
    {
        "mcpId": "github-mcp",
        "name": "GitHub MCP",
        "description": "Repository management, PR reviews, issue tracking",
        "category": "department",
        "tools": ["list_repos", "create_pr", "review_pr", "manage_issues"],
    },
    {
        "mcpId": "jira-mcp",
        "name": "Jira MCP",
        "description": "Issue tracking, sprint management, project boards",
        "category": "department",
        "tools": ["search_issues", "create_issue", "update_sprint"],
    },
    {
        "mcpId": "athena-mcp",
        "name": "Athena Query MCP",
        "description": "SQL queries on S3 data lakes, data catalog access",
        "category": "department",
        "tools": ["run_query", "list_databases", "get_query_results"],
    },
    {
        "mcpId": "s3-mcp",
        "name": "S3 Data MCP",
        "description": "S3 bucket access, object management, presigned URLs",
        "category": "department",
        "tools": ["list_objects", "get_object", "generate_presigned_url"],
    },
    {
        "mcpId": "slack-mcp",
        "name": "Slack MCP",
        "description": "Channel messaging, notifications, workflow integration",
        "category": "department",
        "tools": ["send_message", "list_channels", "search_messages"],
    },
]


def seed_catalog(dynamodb, dry_run: bool):
    """Seed MCP catalog items."""
    print(f"\n{'[DRY RUN] ' if dry_run else ''}Seeding {len(CATALOG_ITEMS)} MCP catalog items...")
    now = datetime.utcnow().isoformat() + "Z"

    for item in CATALOG_ITEMS:
        ddb_item = {
            "PK": {"S": f"MCP#{item['mcpId']}"},
            "SK": {"S": "META"},
            "name": {"S": item["name"]},
            "description": {"S": item["description"]},
            "category": {"S": item["category"]},
            "tools": {"L": [{"S": t} for t in item["tools"]]},
            "enabled": {"BOOL": True},
            "createdAt": {"S": now},
        }

        print(f"  {item['mcpId']:20s} [{item['category']:10s}] {item['name']}")

        if not dry_run:
            dynamodb.put_item(TableName=CATALOG_TABLE, Item=ddb_item)

    print(f"{'[DRY RUN] ' if dry_run else ''}Catalog seeded.")


def seed_common_gateway(dynamodb, dry_run: bool):
    """Create COMMON gateway record in dept-mcp-config."""
    print(f"\n{'[DRY RUN] ' if dry_run else ''}Creating COMMON gateway record...")
    now = datetime.utcnow().isoformat() + "Z"

    item = {
        "PK": {"S": "DEPT#COMMON"},
        "SK": {"S": "GATEWAY"},
        "status": {"S": "PENDING"},
        "createdAt": {"S": now},
        "description": {"S": "Company-wide common MCP gateway"},
    }

    if not dry_run:
        dynamodb.put_item(TableName=CONFIG_TABLE, Item=item)

    print(f"{'[DRY RUN] ' if dry_run else ''}COMMON gateway record created.")

    # Assign common MCPs to COMMON gateway
    common_mcps = [i["mcpId"] for i in CATALOG_ITEMS if i["category"] == "common"]
    print(f"{'[DRY RUN] ' if dry_run else ''}Assigning {len(common_mcps)} common MCPs...")

    for mcp_id in common_mcps:
        mcp_item = {
            "PK": {"S": "DEPT#COMMON"},
            "SK": {"S": f"MCP#{mcp_id}"},
            "enabled": {"BOOL": True},
            "assignedAt": {"S": now},
            "assignedBy": {"S": "seed-script"},
        }

        print(f"  COMMON <- {mcp_id}")
        if not dry_run:
            dynamodb.put_item(TableName=CONFIG_TABLE, Item=mcp_item)


def main():
    parser = argparse.ArgumentParser(description="Seed MCP Catalog")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without writing")
    parser.add_argument("--region", default="ap-northeast-2", help="AWS region")
    args = parser.parse_args()

    print(f"Region: {args.region}")
    print(f"Catalog table: {CATALOG_TABLE}")
    print(f"Config table: {CONFIG_TABLE}")

    dynamodb = boto3.client("dynamodb", region_name=args.region)

    seed_catalog(dynamodb, args.dry_run)
    seed_common_gateway(dynamodb, args.dry_run)

    print("\nDone!")


if __name__ == "__main__":
    main()
