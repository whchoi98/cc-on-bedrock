import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  DynamoDBClient,
  QueryCommand,
  PutItemCommand,
  DeleteItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";

const region = process.env.AWS_REGION ?? "ap-northeast-2";
const DEPT_MCP_CONFIG_TABLE = process.env.DEPT_MCP_CONFIG_TABLE ?? "cc-dept-mcp-config";

const dynamodb = new DynamoDBClient({ region });

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const department = req.nextUrl.searchParams.get("department");
  if (!department) {
    return NextResponse.json({ error: "department parameter required" }, { status: 400 });
  }

  try {
    const result = await dynamodb.send(
      new QueryCommand({
        TableName: DEPT_MCP_CONFIG_TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({
          ":pk": `DEPT#${department}`,
          ":prefix": "MCP#",
        }),
      })
    );

    const assignments = (result.Items ?? []).map((item) => {
      const u = unmarshall(item);
      return {
        mcpId: (u.SK as string).replace("MCP#", ""),
        department,
        enabled: u.enabled !== false,
        assignedAt: u.assignedAt ?? "",
        assignedBy: u.assignedBy ?? "",
      };
    });

    return NextResponse.json({ success: true, data: assignments });
  } catch (err) {
    console.error("[mcp/assignments] GET", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { department, mcpId, action } = body;

    if (!department || !mcpId || !action) {
      return NextResponse.json(
        { error: "department, mcpId, and action required" },
        { status: 400 }
      );
    }

    // Validate gateway exists for this department
    const gwResult = await dynamodb.send(
      new GetItemCommand({
        TableName: DEPT_MCP_CONFIG_TABLE,
        Key: marshall({ PK: `DEPT#${department}`, SK: "GATEWAY" }),
      })
    );

    if (!gwResult.Item) {
      return NextResponse.json(
        { error: "Department gateway must be created first" },
        { status: 400 }
      );
    }

    if (action === "assign") {
      await dynamodb.send(
        new PutItemCommand({
          TableName: DEPT_MCP_CONFIG_TABLE,
          Item: marshall({
            PK: `DEPT#${department}`,
            SK: `MCP#${mcpId}`,
            enabled: true,
            assignedAt: new Date().toISOString(),
            assignedBy: session.user.email,
          }),
        })
      );
    } else if (action === "remove") {
      await dynamodb.send(
        new DeleteItemCommand({
          TableName: DEPT_MCP_CONFIG_TABLE,
          Key: marshall({ PK: `DEPT#${department}`, SK: `MCP#${mcpId}` }),
        })
      );
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: { department, mcpId, action },
    });
  } catch (err) {
    console.error("[mcp/assignments] PUT", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
