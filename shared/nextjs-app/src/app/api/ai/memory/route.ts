import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  ListEventsCommand,
} from "@aws-sdk/client-bedrock-agentcore";

const region = process.env.AWS_REGION ?? "ap-northeast-2";
const MEMORY_ID = process.env.AGENTCORE_MEMORY_ID ?? "cconbedrock_memory-pHqYq73dKd";

function getClient() {
  return new BedrockAgentCoreClient({ region });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);
  const userEmail = session.user.email ?? "default";
  // Use email as sessionId (user-scoped conversation history)
  const sessionId = userEmail.replace(/[^a-zA-Z0-9_-]/g, "_");

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getClient().send(new ListEventsCommand({
      memoryId: MEMORY_ID,
      sessionId,
      maxResults: Math.min(limit, 100),
    } as any));

    const events = (result.events ?? []).map((e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let payload: Record<string, any> = {};
      try {
        if (e.payload) payload = e.payload as any;
      } catch { /* ignore */ }
      return {
        id: e.eventId,
        timestamp: payload.timestamp ?? "",
        question: payload.question ?? "",
        answer: String(payload.answer ?? "").slice(0, 200),
        tools: payload.tools ?? [],
        tokens: payload.tokens ?? { input: 0, output: 0 },
        responseTime: payload.responseTime ?? 0,
      };
    });

    return NextResponse.json({ success: true, data: events });
  } catch (err) {
    console.error("[Memory] List error:", (err as Error).message);
    // Return empty on error (memory may not have events yet)
    return NextResponse.json({ success: true, data: [] });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { question, answer, tools, inputTokens, outputTokens, responseTime } = body;
  const userEmail = session.user.email ?? "default";
  const sessionId = userEmail.replace(/[^a-zA-Z0-9_-]/g, "_");

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getClient().send(new CreateEventCommand({
      memoryId: MEMORY_ID,
      sessionId,
      actorId: userEmail,
      payload: {
        question,
        answer: String(answer).slice(0, 5000),
        tools: tools ?? [],
        tokens: { input: inputTokens ?? 0, output: outputTokens ?? 0 },
        responseTime: responseTime ?? 0,
        timestamp: new Date().toISOString(),
      },
    } as any));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Memory] Save error:", (err as Error).message);
    return NextResponse.json({ success: false, error: (err as Error).message });
  }
}
