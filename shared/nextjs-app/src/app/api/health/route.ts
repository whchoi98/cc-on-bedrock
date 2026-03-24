import { NextResponse } from "next/server";

export async function GET() {
  const checks: Record<string, { status: string; message?: string }> = {};

  // Dashboard self-check
  checks["dashboard"] = { status: "healthy" };

  // Architecture: Direct Bedrock mode (LiteLLM removed)
  checks["architecture"] = { status: "healthy", message: "Direct Bedrock (no proxy)" };

  const allHealthy = Object.values(checks).every(
    (c) => c.status === "healthy"
  );

  return NextResponse.json(
    {
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: allHealthy ? 200 : 503 }
  );
}
