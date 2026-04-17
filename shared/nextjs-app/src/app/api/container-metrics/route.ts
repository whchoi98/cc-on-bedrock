import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getEc2AggregateMetrics,
  getEc2TimeSeries,
} from "@/lib/cloudwatch-client";
import { listInstances } from "@/lib/ec2-clients";
import {
  getBedrockUsageSnapshot,
  getBedrockUsageTimeSeries,
} from "@/lib/usage-client";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") ?? "current";

  try {
    const instances = await listInstances();
    const runningIds = instances
      .filter((i) => i.status === "running")
      .map((i) => i.instanceId);

    switch (action) {
      case "current": {
        const metrics = await getEc2AggregateMetrics(runningIds);
        return NextResponse.json({ success: true, data: metrics });
      }
      case "timeseries": {
        const hours = Math.min(Math.max(parseInt(searchParams.get("hours") ?? "6", 10), 1), 168);
        // Use the first running instance for timeseries, or return empty
        if (runningIds.length === 0) {
          return NextResponse.json({ success: true, data: { timestamps: [], cpu: [], memory: [], networkRx: [], networkTx: [] } });
        }
        const ts = await getEc2TimeSeries(runningIds[0], hours);
        return NextResponse.json({ success: true, data: ts });
      }
      case "instances": {
        // Per-instance metrics with tag info
        const metrics = await getEc2AggregateMetrics(runningIds);
        const instanceData = instances
          .filter((i) => i.status === "running")
          .map((i) => {
            const m = metrics.instances.find((mi) => mi.instanceId === i.instanceId);
            return {
              instanceId: i.instanceId,
              subdomain: i.subdomain,
              username: i.username,
              instanceType: i.instanceType,
              cpu: m?.cpu ?? 0,
              memory: m?.memory ?? 0,
              networkRx: m?.networkRx ?? 0,
              networkTx: m?.networkTx ?? 0,
            };
          });
        return NextResponse.json({ success: true, data: instanceData });
      }
      case "bedrock": {
        const brMetrics = await getBedrockUsageSnapshot();
        return NextResponse.json({ success: true, data: brMetrics });
      }
      case "bedrock_timeseries": {
        const brDays = Math.min(Math.max(parseInt(searchParams.get("days") ?? "7", 10), 1), 90);
        const brTs = await getBedrockUsageTimeSeries(brDays);
        return NextResponse.json({ success: true, data: brTs });
      }
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    console.error("[container-metrics]", action, err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
