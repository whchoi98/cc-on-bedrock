import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";

const region = process.env.AWS_REGION ?? "ap-northeast-2";
const DEPT_MCP_CONFIG_TABLE = process.env.DEPT_MCP_CONFIG_TABLE ?? "cc-dept-mcp-config";
const GATEWAY_MANAGER_FUNCTION = process.env.GATEWAY_MANAGER_FUNCTION ?? "cc-on-bedrock-gateway-manager";

const dynamodb = new DynamoDBClient({ region });
const lambda = new LambdaClient({ region });

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const result = await dynamodb.send(
      new ScanCommand({
        TableName: DEPT_MCP_CONFIG_TABLE,
        FilterExpression: "SK = :sk",
        ExpressionAttributeValues: marshall({ ":sk": "GATEWAY" }),
      })
    );

    const gateways = (result.Items ?? []).map((item) => {
      const u = unmarshall(item);
      return {
        department: (u.PK as string).replace("DEPT#", ""),
        gatewayId: u.gatewayId ?? "",
        gatewayUrl: u.gatewayUrl ?? "",
        status: u.status ?? "UNKNOWN",
        roleArn: u.roleArn ?? "",
        createdAt: u.createdAt ?? "",
        lastSyncAt: u.lastSyncAt ?? "",
      };
    });

    return NextResponse.json({ success: true, data: gateways });
  } catch (err) {
    console.error("[mcp/gateways] GET", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { department } = body;

    if (!department) {
      return NextResponse.json({ error: "department required" }, { status: 400 });
    }

    // Write initial gateway record to DDB (this triggers Streams → Lambda)
    await dynamodb.send(
      new PutItemCommand({
        TableName: DEPT_MCP_CONFIG_TABLE,
        Item: marshall({
          PK: `DEPT#${department}`,
          SK: "GATEWAY",
          status: "CREATING",
          createdAt: new Date().toISOString(),
          createdBy: session.user.email,
        }),
      })
    );

    // Also invoke Lambda directly for immediate creation
    await lambda.send(
      new InvokeCommand({
        FunctionName: GATEWAY_MANAGER_FUNCTION,
        InvocationType: "Event",
        Payload: Buffer.from(
          JSON.stringify({
            action: "create_gateway",
            department,
          })
        ),
      })
    );

    return NextResponse.json({
      success: true,
      data: { department, status: "CREATING" },
    });
  } catch (err) {
    console.error("[mcp/gateways] POST", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { department } = body;

    if (!department) {
      return NextResponse.json({ error: "department required" }, { status: 400 });
    }

    // Update status to DELETING
    await dynamodb.send(
      new PutItemCommand({
        TableName: DEPT_MCP_CONFIG_TABLE,
        Item: marshall({
          PK: `DEPT#${department}`,
          SK: "GATEWAY",
          status: "DELETING",
          deletedAt: new Date().toISOString(),
          deletedBy: session.user.email,
        }),
      })
    );

    // Invoke Lambda for deletion
    await lambda.send(
      new InvokeCommand({
        FunctionName: GATEWAY_MANAGER_FUNCTION,
        InvocationType: "Event",
        Payload: Buffer.from(
          JSON.stringify({
            action: "delete_gateway",
            department,
          })
        ),
      })
    );

    return NextResponse.json({
      success: true,
      data: { department, status: "DELETING" },
    });
  } catch (err) {
    console.error("[mcp/gateways] DELETE", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
