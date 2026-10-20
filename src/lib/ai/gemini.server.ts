// Gemini provider. Server-only: the key is read inside the call and never bundled.
//
// Shapes verified against Google's docs on 20 Oct 2026:
//   POST https://generativelanguage.googleapis.com/v1beta/interactions
//   headers: x-goog-api-key, content-type
//   body:    { model, system_instruction, input, response_format, generation_config }
//   output:  steps[] → { type: "model_output", content: [{ type: "text", text }] }
//
// The model id is an environment variable because model names move: a stale default is
// then one variable away from fixed, not a redeploy of changed code.
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_MODEL = "gemini-3-flash-preview";

/**
 * Tried in order when the chosen model answers "high demand" (503). Capacity moves
 * hour to hour, and a demo should not die because one model is busy. Override with
 * GEMINI_MODEL_FALLBACKS as a comma-separated list.
 */
// One alternate only. Walking a long chain on a busy model costs more wall clock than
// the answer is worth, and the rule-backed text is always there to fall back to.
const DEFAULT_FALLBACKS = ["gemini-3.6-flash"];

function fallbackModels(primary: string): string[] {
  const configured = process.env["GEMINI_MODEL_FALLBACKS"];
  const list = configured ? configured.split(",").map((m) => m.trim()).filter(Boolean) : DEFAULT_FALLBACKS;
  return list.filter((m) => m !== primary);
}

const RETRYABLE = /service_unavailable|high demand|overloaded|resource_exhausted|^http_(429|500|502|503|504)/i;

export interface GeminiRequest {
  system: string;
  input: string;
  /** JSON Schema the response must satisfy. Enforced by the API, re-checked by us. */
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export type GeminiResult =
  | { ok: true; data: unknown; model: string; latencyMs: number; totalTokens: number | null }
  | { ok: false; error: string; model: string; latencyMs: number };

export function geminiModelId(): string {
  return process.env["GEMINI_MODEL"] ?? DEFAULT_MODEL;
}

export function geminiIsConfigured(): boolean {
  return Boolean(process.env["GEMINI_API_KEY"] ?? process.env["LLM_API_KEY"]);
}

/** Pulls the text out of the response, tolerating either documented shape. */
function extractText(payload: Record<string, unknown>): string | null {
  const direct = payload["output_text"];
  if (typeof direct === "string" && direct.trim()) return direct;

  const steps = payload["steps"];
  if (!Array.isArray(steps)) return null;
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i] as Record<string, unknown> | undefined;
    if (!step || step["type"] !== "model_output") continue;
    const content = step["content"];
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
      .filter((c) => c["type"] === "text")
      .map((c) => String(c["text"] ?? ""))
      .join("")
      .trim();
    if (text) return text;
  }
  return null;
}

/** One attempt against one model. */
async function callOnce(request: GeminiRequest, model: string): Promise<GeminiResult> {
  const started = Date.now();
  const key = process.env["GEMINI_API_KEY"] ?? process.env["LLM_API_KEY"];
  if (!key) return { ok: false, error: "not_configured", model, latencyMs: 0 };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 12_000);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        system_instruction: request.system,
        input: request.input,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: request.schema,
        },
        generation_config: {
          // Thinking tokens come out of this budget, so a tight limit returns
          // status "incomplete" with a truncated body rather than an error.
          max_output_tokens: request.maxOutputTokens ?? 1600,
          thinking_level: "low",
        },
      }),
    });

    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      return { ok: false, error: `http_${response.status}: ${body}`, model, latencyMs };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    if (payload["status"] && payload["status"] !== "completed") {
      return { ok: false, error: `status_${String(payload["status"])}`, model, latencyMs };
    }

    const text = extractText(payload);
    if (!text) return { ok: false, error: "empty_response", model, latencyMs };

    const usage = payload["usage"] as Record<string, unknown> | undefined;
    const totalTokens = usage && typeof usage["total_tokens"] === "number" ? (usage["total_tokens"] as number) : null;

    try {
      return { ok: true, data: JSON.parse(text), model, latencyMs, totalTokens };
    } catch {
      return { ok: false, error: "invalid_json", model, latencyMs };
    }
  } catch (err) {
    const latencyMs = Date.now() - started;
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, error: aborted ? "timeout" : String(err).slice(0, 200), model, latencyMs };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Calls the configured model, then its fallbacks if it reports high demand. Returns the
 * first usable answer, or the last error so the caller can record why it fell back.
 */
export async function callGemini(request: GeminiRequest): Promise<GeminiResult> {
  const primary = geminiModelId();
  if (!geminiIsConfigured()) {
    return { ok: false, error: "not_configured", model: primary, latencyMs: 0 };
  }

  let last: GeminiResult = { ok: false, error: "no_attempt", model: primary, latencyMs: 0 };
  for (const model of [primary, ...fallbackModels(primary)]) {
    const result = await callOnce(request, model);
    if (result.ok) return result;
    last = result;
    if (!RETRYABLE.test(result.error)) break;
  }
  return last;
}
