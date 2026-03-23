import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  ListEventsCommand,
} from "@aws-sdk/client-bedrock-agentcore";

const region = process.env.AWS_REGION ?? "ap-northeast-2";
const MEMORY_ID = process.env.AGENTCORE_MEMORY_ID ?? "";

function getClient() {
  return new BedrockAgentCoreClient({ region });
}

function sanitizeId(email: string): string {
  return email.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);
  const userEmail = session.user.email ?? "default";
  const actorId = sanitizeId(userEmail);
  const sessionId = `session_${actorId}`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getClient().send(new ListEventsCommand({
      memoryId: MEMORY_ID,
      sessionId,
      actorId,
      includePayloads: true,
      pageSize: Math.min(limit, 50),
    } as any));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (result.events ?? []).map((e: any) => {
      const payloads = e.payload ?? [];
      let question = "";
      let answerFull = "";

      for (const p of payloads) {
        if (p.conversational) {
          const text = p.conversational.content?.text ?? "";
          if (p.conversational.role === "USER") question = text;
          if (p.conversational.role === "ASSISTANT") answerFull = text;
        }
      }

      // Parse metadata from answer footer [tools:...][in:...][out:...][time:...]
      const toolsMatch = answerFull.match(/\[tools:([^\]]*)\]/);
      const inMatch = answerFull.match(/\[in:(\d+)\]/);
      const outMatch = answerFull.match(/\[out:(\d+)\]/);
      const timeMatch = answerFull.match(/\[time:(\d+)\]/);
      const answer = answerFull.replace(/\n\n---\n\[tools:.*$/, "").slice(0, 200);

      return {
        id: e.eventId,
        timestamp: e.eventTimestamp ?? e.createdAt ?? "",
        question,
        answer,
        tools: toolsMatch?.[1] ? toolsMatch[1].split(",").filter(Boolean) : [],
        tokens: { input: parseInt(inMatch?.[1] ?? "0"), output: parseInt(outMatch?.[1] ?? "0") },
        responseTime: parseInt(timeMatch?.[1] ?? "0"),
      };
    }).filter((e: any) => e.question);

    return NextResponse.json({ success: true, data: events });
  } catch (err) {
    console.error("[Memory] List error:", (err as Error).message);
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
  const actorId = sanitizeId(userEmail);
  const sessionId = `session_${actorId}`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getClient().send(new CreateEventCommand({
      memoryId: MEMORY_ID,
      sessionId,
      actorId,
      eventTimestamp: new Date(),
      payload: [
        {
          conversational: {
            content: { text: question },
            role: "USER",
          },
        },
        {
          conversational: {
            content: { text: `${String(answer).slice(0, 4500)}\n\n---\n[tools:${(tools ?? []).join(",")}][in:${inputTokens ?? 0}][out:${outputTokens ?? 0}][time:${responseTime ?? 0}]` },
            role: "ASSISTANT",
          },
        },
      ],
    } as any));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Memory] Save error:", (err as Error).message);
    return NextResponse.json({ success: false, error: (err as Error).message });
  }
}
