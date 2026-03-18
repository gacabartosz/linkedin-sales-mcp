/**
 * Gemini Flash text generation for AI classification.
 * Stripped version — no image generation.
 */

import { config } from "../utils/config.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { log } from "../utils/logger.js";

interface GeminiTextResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

export async function generateText(options: {
  system?: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string> {
  if (!config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY not set.");
  }

  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: options.prompt }] }],
    generationConfig: {
      maxOutputTokens: options.maxTokens || 300,
      temperature: 0.7,
    },
  };

  if (options.system) {
    body.systemInstruction = { parts: [{ text: options.system }] };
  }

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as GeminiTextResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned no text content.");
  }
  return text.trim();
}
