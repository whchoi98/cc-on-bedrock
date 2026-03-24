import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  startContainer,
  stopContainer,
  listContainers,
  describeContainer,
  registerContainerInAlb,
  deregisterContainerFromAlb,
} from "@/lib/aws-clients";
import type { StartContainerInput, StopContainerInput } from "@/lib/types";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const taskArn = searchParams.get("taskArn");

  try {
    if (taskArn) {
      const container = await describeContainer(taskArn);
      if (!container) {
        return NextResponse.json({ success: false, error: "Container not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: container });
    }
    const containers = await listContainers();
    return NextResponse.json({ success: true, data: containers });
  } catch (err) {
    console.error("[containers] GET", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as StartContainerInput;
    const taskArn = await startContainer(body);

    // Auto-register in ALB after a short delay for IP assignment
    // Run in background - don't block the response
    setTimeout(async () => {
      try {
        // Wait for task to get an IP (up to 30s)
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          const info = await describeContainer(taskArn);
          if (info?.privateIp) {
            await registerContainerInAlb(body.subdomain, info.privateIp);
            break;
          }
        }
      } catch (err) {
        console.error("[containers] ALB register failed:", err);
      }
    }, 2000);

    return NextResponse.json({ success: true, data: { taskArn } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[containers] POST", message);
    const isDuplicate = message.includes("already has a running container");
    return NextResponse.json(
      { success: false, error: isDuplicate ? message : "Internal server error" },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as StopContainerInput & { subdomain?: string };

    // Deregister from ALB before stopping
    if (body.subdomain) {
      try {
        await deregisterContainerFromAlb(body.subdomain);
      } catch (err) {
        console.warn("[containers] ALB deregister:", err);
      }
    }

    await stopContainer(body);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[containers] DELETE", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
