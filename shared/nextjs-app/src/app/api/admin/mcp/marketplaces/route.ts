import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  DynamoDBClient,
  QueryCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const region = process.env.AWS_REGION ?? "ap-northeast-2";
const DEPT_MCP_CONFIG_TABLE =
  process.env.DEPT_MCP_CONFIG_TABLE ?? "cc-dept-mcp-config";
const dynamodb = new DynamoDBClient({ region });

function scopeToPK(scope: string): string {
  return scope === "common" ? "COMMON" : `DEPT#${scope}`;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") ?? "common";

  try {
    const result = await dynamodb.send(
      new QueryCommand({
        TableName: DEPT_MCP_CONFIG_TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: marshall({
          ":pk": scopeToPK(scope),
          ":prefix": "MKTPLACE#",
        }),
      })
    );

    const marketplaces = (result.Items ?? []).map((item) => {
      const u = unmarshall(item);
      return {
        id: (u.SK as string).replace("MKTPLACE#", ""),
        name: u.name ?? "",
        url: u.url ?? "",
        description: u.description ?? "",
        enabled: u.enabled ?? true,
        addedBy: u.addedBy ?? "",
        addedAt: u.addedAt ?? "",
      };
    });

    return NextResponse.json({ success: true, data: marketplaces });
  } catch (err) {
    console.error(
      "[admin/mcp/marketplaces] GET",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { id, name, url, description, scope } = body as {
      id: string;
      name: string;
      url: string;
      description?: string;
      scope: string;
    };

    if (!id || !name || !url || !scope) {
      return NextResponse.json(
        { error: "id, name, url, and scope are required" },
        { status: 400 }
      );
    }

    if (!/^[a-z0-9-]+$/.test(id)) {
      return NextResponse.json(
        { error: "id must be lowercase alphanumeric with hyphens" },
        { status: 400 }
      );
    }

    if (!url.startsWith("https://github.com/")) {
      return NextResponse.json(
        { error: "URL must be a GitHub repository (https://github.com/...)" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const adminEmail = session.user.email ?? "unknown";

    await dynamodb.send(
      new PutItemCommand({
        TableName: DEPT_MCP_CONFIG_TABLE,
        Item: marshall(
          {
            PK: scopeToPK(scope),
            SK: `MKTPLACE#${id}`,
            name,
            url,
            description: description ?? "",
            enabled: true,
            addedBy: adminEmail,
            addedAt: now,
          },
          { removeUndefinedValues: true }
        ),
      })
    );

    return NextResponse.json({
      success: true,
      message: `Marketplace ${id} added to ${scope}`,
    });
  } catch (err) {
    console.error(
      "[admin/mcp/marketplaces] POST",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { id, scope, enabled, name, url, description } = body as {
      id: string;
      scope: string;
      enabled?: boolean;
      name?: string;
      url?: string;
      description?: string;
    };

    if (!id || !scope) {
      return NextResponse.json(
        { error: "id and scope are required" },
        { status: 400 }
      );
    }

    if (url && !url.startsWith("https://github.com/")) {
      return NextResponse.json(
        { error: "URL must be a GitHub repository (https://github.com/...)" },
        { status: 400 }
      );
    }

    const updates: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    if (enabled !== undefined) {
      updates.push("enabled = :enabled");
      values[":enabled"] = enabled;
    }
    if (name) {
      updates.push("#n = :name");
      names["#n"] = "name";
      values[":name"] = name;
    }
    if (url) {
      updates.push("#u = :url");
      names["#u"] = "url";
      values[":url"] = url;
    }
    if (description !== undefined) {
      updates.push("description = :desc");
      values[":desc"] = description;
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    await dynamodb.send(
      new UpdateItemCommand({
        TableName: DEPT_MCP_CONFIG_TABLE,
        Key: marshall({ PK: scopeToPK(scope), SK: `MKTPLACE#${id}` }),
        UpdateExpression: `SET ${updates.join(", ")}`,
        ...(Object.keys(names).length > 0 && {
          ExpressionAttributeNames: names,
        }),
        ExpressionAttributeValues: marshall(values),
      })
    );

    return NextResponse.json({
      success: true,
      message: `Marketplace ${id} updated`,
    });
  } catch (err) {
    console.error(
      "[admin/mcp/marketplaces] PUT",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { id, scope } = body as { id: string; scope: string };

    if (!id || !scope) {
      return NextResponse.json(
        { error: "id and scope are required" },
        { status: 400 }
      );
    }

    await dynamodb.send(
      new DeleteItemCommand({
        TableName: DEPT_MCP_CONFIG_TABLE,
        Key: marshall({ PK: scopeToPK(scope), SK: `MKTPLACE#${id}` }),
      })
    );

    return NextResponse.json({
      success: true,
      message: `Marketplace ${id} removed from ${scope}`,
    });
  } catch (err) {
    console.error(
      "[admin/mcp/marketplaces] DELETE",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
