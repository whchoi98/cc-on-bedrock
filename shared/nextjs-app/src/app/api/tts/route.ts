import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  PollyClient,
  SynthesizeSpeechCommand,
} from "@aws-sdk/client-polly";

const region = process.env.AWS_REGION ?? "ap-northeast-2";

function getPollyClient() {
  return new PollyClient({ region });
}

// Clean markdown to natural speech text
function cleanForSpeech(text: string): string {
  return text
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\|[^\n]+\|/g, "")
    .replace(/[-─═]{3,}/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[🔧📊⚡⏱🟢🟡🔴⚠️❌✓✗🎤🔊🔇⏹💰🤖🐳🏥🔑🛡️]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 3000); // Polly limit
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const { text, lang = "ko" } = body as { text: string; lang?: string };

  if (!text) {
    return new Response("No text", { status: 400 });
  }

  const cleanText = cleanForSpeech(text);
  if (!cleanText) {
    return new Response("Empty after cleaning", { status: 400 });
  }

  try {
    const command = new SynthesizeSpeechCommand({
      Text: cleanText,
      OutputFormat: "mp3",
      VoiceId: lang === "ko" ? "Seoyeon" : "Ruth",
      Engine: "generative",
      LanguageCode: lang === "ko" ? "ko-KR" : "en-US",
    });

    const result = await getPollyClient().send(command);

    if (!result.AudioStream) {
      return new Response("No audio", { status: 500 });
    }

    // Convert stream to bytes
    const chunks: Uint8Array[] = [];
    if (Symbol.asyncIterator in (result.AudioStream as object)) {
      for await (const chunk of result.AudioStream as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
    } else if ("transformToByteArray" in (result.AudioStream as object)) {
      const bytes = await (result.AudioStream as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
      chunks.push(bytes);
    }

    const audioBuffer = Buffer.concat(chunks);

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.length),
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("[TTS] Polly error:", (err as Error).message);
    return new Response("Internal server error", { status: 500 });
  }
}
