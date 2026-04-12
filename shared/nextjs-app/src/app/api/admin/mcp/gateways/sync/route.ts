import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const region = process.env.AWS_REGION ?? "ap-northeast-2";
const GATEWAY_MANAGER_FUNCTION = process.env.GATEWAY_MANAGER_FUNCTION ?? "cc-on-bedrock-gateway-manager";

const lambda = new LambdaClient({ region });

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

    await lambda.send(
      new InvokeCommand({
        FunctionName: GATEWAY_MANAGER_FUNCTION,
        InvocationType: "Event",
        Payload: Buffer.from(
          JSON.stringify({
            action: "sync_gateway",
            department,
          })
        ),
      })
    );

    return NextResponse.json({
      success: true,
      data: { department, message: "Sync triggered" },
    });
  } catch (err) {
    console.error("[mcp/gateways/sync] POST", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
