import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message,
  type ContentBlock,
  type ToolConfiguration,
  type ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { listContainers } from "@/lib/aws-clients";
import { getContainerMetrics } from "@/lib/cloudwatch-client";

const region = process.env.AWS_REGION ?? "ap-northeast-2";
const MODEL_ID = "global.anthropic.claude-sonnet-4-6";

function getBedrockClient() {
  return new BedrockRuntimeClient({ region });
}

// ── Gather platform context (no LiteLLM dependency) ──
async function gatherContext(): Promise<string> {
  try {
    const [containers, cwMetrics] = await Promise.all([
      listContainers().catch(() => []),
      getContainerMetrics().catch(() => null),
    ]);

    const running = containers.filter(c => c.status === "RUNNING");
    const containerLines = running.map(c =>
      `${c.username || c.subdomain}: ${c.containerOs}/${c.resourceTier} (${c.status})`
    ).join("\n");

    let cwLines = "N/A";
    if (cwMetrics) {
      cwLines = `CPU: ${cwMetrics.cpuUtilizationPct.toFixed(1)}%, Memory: ${cwMetrics.memoryUtilizationPct.toFixed(1)}%, Tasks: ${cwMetrics.taskCount}, Hosts: ${cwMetrics.containerInstanceCount}`;
    }

    return `[Platform Data - Direct Bedrock Mode]
Architecture: Claude Code → ECS Task Role → Bedrock (direct, no proxy)
Containers: ${running.length}/${containers.length} running
${containerLines}
Cluster Metrics: ${cwLines}
Region: ${region}
Note: Usage tracking via CloudTrail (data may have 1-5 min delay)`;
  } catch {
    return "[Platform data unavailable]";
  }
}

// ── Tool definitions ──
const toolConfig: ToolConfiguration = {
  tools: [
    { toolSpec: { name: "get_container_status", description: "Get ECS container status, user assignments, OS type, resource tier for all running development environments", inputSchema: { json: { type: "object", properties: {}, required: [] } } } },
    { toolSpec: { name: "get_container_metrics", description: "Get CloudWatch CPU, Memory, Network metrics for the ECS cluster", inputSchema: { json: { type: "object", properties: {}, required: [] } } } },
    { toolSpec: { name: "get_platform_summary", description: "Get overall platform summary including architecture, container status, and cluster health", inputSchema: { json: { type: "object", properties: {}, required: [] } } } },
  ],
};

async function executeTool(toolName: string): Promise<string> {
  try {
    switch (toolName) {
      case "get_container_status": {
        const c = await listContainers();
        const running = c.filter(x => x.status === "RUNNING");
        const osDist: Record<string, number> = {};
        const tierDist: Record<string, number> = {};
        for (const r of running) {
          osDist[r.containerOs] = (osDist[r.containerOs] ?? 0) + 1;
          tierDist[r.resourceTier] = (tierDist[r.resourceTier] ?? 0) + 1;
        }
        return JSON.stringify({
          total: c.length,
          running: running.length,
          osDist,
          tierDist,
          containers: c.map(x => ({
            user: x.username || x.subdomain,
            status: x.status,
            os: x.containerOs,
            tier: x.resourceTier,
            cpu: x.cpu,
            memory: x.memory,
            startedAt: x.startedAt,
            ip: x.privateIp,
          })),
        });
      }
      case "get_container_metrics": {
        const m = await getContainerMetrics();
        return JSON.stringify({
          cpu_pct: m.cpuUtilizationPct.toFixed(1),
          mem_pct: m.memoryUtilizationPct.toFixed(1),
          cpu_utilized: m.cpuUtilized,
          cpu_reserved: m.cpuReserved,
          memory_utilized_mib: m.memoryUtilized,
          memory_reserved_mib: m.memoryReserved,
          network_rx_bytes: m.networkRxBytes,
          network_tx_bytes: m.networkTxBytes,
          tasks: m.taskCount,
          hosts: m.containerInstanceCount,
        });
      }
      case "get_platform_summary": {
        return await gatherContext();
      }
      default: return JSON.stringify({ error: "Unknown tool" });
    }
  } catch (e) { return JSON.stringify({ error: String(e) }); }
}

// ── Converse API with tool use ──
async function converseWithTools(
  userMessages: { role: string; content: string }[],
  lang: string,
  send: (data: Record<string, unknown>) => void,
): Promise<void> {
  const systemPrompt = `You are CC-on-Bedrock AI Assistant. You manage a multi-user Claude Code platform on AWS Bedrock.
Architecture: Users run Claude Code in ECS containers with direct Bedrock access via Task Roles. No proxy.
Use tools to get current data before answering. ${lang === "ko" ? "Respond in Korean." : "Respond in English."}
Use markdown tables for comparisons. Format numbers clearly.`;

  const messages: Message[] = userMessages.map(m => ({
    role: m.role as "user" | "assistant",
    content: [{ text: m.content }],
  }));

  for (let iteration = 0; iteration < 5; iteration++) {
    try {
      const cmd = new ConverseStreamCommand({
        modelId: MODEL_ID, system: [{ text: systemPrompt }],
        messages, toolConfig, inferenceConfig: { maxTokens: 4096 },
      });

      const resp = await getBedrockClient().send(cmd);
      let text = "";
      let stopReason = "";
      const toolCalls: { id: string; name: string }[] = [];
      let currentToolId = "";
      let currentToolName = "";

      if (resp.stream) {
        for await (const ev of resp.stream) {
          if (ev.contentBlockDelta?.delta?.text) {
            text += ev.contentBlockDelta.delta.text;
            send({ text: ev.contentBlockDelta.delta.text });
          }
          if (ev.contentBlockStart?.start?.toolUse) {
            currentToolId = ev.contentBlockStart.start.toolUse.toolUseId ?? "";
            currentToolName = ev.contentBlockStart.start.toolUse.name ?? "";
            send({ status: `tool: ${currentToolName}` });
          }
          if (ev.contentBlockStop && currentToolName) {
            toolCalls.push({ id: currentToolId, name: currentToolName });
            currentToolName = "";
            currentToolId = "";
          }
          if (ev.messageStop) stopReason = ev.messageStop.stopReason ?? "";
          if (ev.metadata?.usage) send({ usage: ev.metadata.usage });
        }
      }

      if (stopReason === "tool_use" && toolCalls.length > 0) {
        const assistantContent: ContentBlock[] = [];
        if (text) assistantContent.push({ text });
        for (const tc of toolCalls) {
          assistantContent.push({ toolUse: { toolUseId: tc.id, name: tc.name, input: {} } });
        }
        messages.push({ role: "assistant", content: assistantContent });

        const toolResults: ContentBlock[] = [];
        for (const tc of toolCalls) {
          const result = await executeTool(tc.name);
          toolResults.push({
            toolResult: {
              toolUseId: tc.id,
              content: [{ text: result }] as ToolResultContentBlock[],
            },
          });
        }
        messages.push({ role: "user", content: toolResults });
        send({ status: "" });
        continue;
      }

      break;
    } catch (err) {
      console.error(`[AI] Converse iteration ${iteration}:`, (err as Error).message);
      send({ text: `\n\nError: ${(err as Error).message}` });
      break;
    }
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return new Response(JSON.stringify({ error: "Admin access required" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json();
  const { messages: userMessages, lang = "ko" } = body as {
    messages: { role: string; content: string }[];
    lang?: string;
  };

  let controllerClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: Record<string, unknown>) => {
        if (controllerClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { controllerClosed = true; }
      };

      try {
        send({ status: "Analyzing with Claude Sonnet 4.6..." });
        await converseWithTools(userMessages.slice(-8), lang, send);
        send({ status: "" });
        send({ done: true, via: "Bedrock Converse + Tool Use (Direct)" });
      } catch (err) {
        console.error("[AI Route]", (err as Error).message);
        try { send({ text: `Error: ${(err as Error).message}` }); send({ done: true }); } catch {}
      } finally {
        if (!controllerClosed) { try { controller.close(); } catch {} }
        controllerClosed = true;
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
