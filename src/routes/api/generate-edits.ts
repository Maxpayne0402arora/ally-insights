import { createFileRoute } from "@tanstack/react-router";

const MODEL = "openai/gpt-6-astra";
const MAX_CHARS = 60_000;
const LIMIT_PER_HOUR = 30;
const HOUR = 60 * 60 * 1000;

// Simple per-client limiter (per server instance).
const hits = new Map<string, number[]>();

const json = (status: number, body: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

const fail = (status: number, error: string, message: string, headers?: Record<string, string>) =>
  json(status, { error, message }, headers);

function clientKey(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anonymous"
  );
}

export const Route = createFileRoute("/api/generate-edits")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { system?: unknown; user?: unknown };
        try {
          body = await request.json();
        } catch {
          return fail(400, "bad_request", "Request body must be JSON.");
        }
        const { system, user } = body ?? {};
        if (typeof system !== "string" || typeof user !== "string" || !system || !user) {
          return fail(400, "bad_request", "Both 'system' and 'user' must be non-empty strings.");
        }
        if (system.length + user.length > MAX_CHARS) {
          return fail(413, "payload_too_large", "This listing is too large to analyse.");
        }

        const key = clientKey(request);
        const now = Date.now();
        const recent = (hits.get(key) ?? []).filter((t) => now - t < HOUR);
        if (recent.length >= LIMIT_PER_HOUR) {
          const retryAfter = Math.ceil((HOUR - (now - (recent[0] ?? now))) / 1000);
          return fail(429, "rate_limited", "Too many requests. Try again later.", { "retry-after": String(retryAfter) });
        }
        recent.push(now);
        hits.set(key, recent);

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return fail(500, "not_configured", "The AI service is not configured.");

        try {
          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
            method: "POST",
            signal: request.signal,
            headers: {
              "content-type": "application/json",
              "Lovable-API-Key": apiKey,
              "X-Lovable-AIG-SDK": "fetch",
            },
            body: JSON.stringify({
              model: MODEL,
              input: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
              stream: true,
              store: false,
              reasoning: { effort: "medium" },
              // Covers the model's reasoning plus ~4,000 tokens of JSON answer.
              max_output_tokens: 12_000,
              text: { format: { type: "json_object" } },
            }),
          });

          if (!upstream.ok || !upstream.body) {
            const raw = await upstream.text().catch(() => "");
            let message = "The AI service returned an error.";
            try {
              const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
              const m = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message;
              if (m) message = String(m).slice(0, 300);
            } catch {
              /* keep default */
            }
            if (upstream.status === 402) return fail(402, "credits_exhausted", message);
            if (upstream.status === 429) return fail(429, "rate_limited", message);
            if (upstream.status === 403) return fail(403, "forbidden", message);
            return fail(502, "upstream_error", `${upstream.status}: ${message}`);
          }

          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let text = "";
          let final: {
            status?: string;
            model?: string;
            usage?: unknown;
            incomplete_details?: { reason?: string } | null;
          } | null = null;
          let streamError: string | null = null;

          const handle = (data: string) => {
            if (!data || data === "[DONE]") return;
            let evt: { type?: string; delta?: string; response?: typeof final; error?: { message?: string }; message?: string };
            try {
              evt = JSON.parse(data);
            } catch {
              return;
            }
            if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") text += evt.delta;
            else if (evt.type === "response.completed" || evt.type === "response.incomplete") final = evt.response ?? null;
            else if (evt.type === "response.failed") {
              final = evt.response ?? null;
              streamError = "The AI response failed.";
            } else if (evt.type === "error") streamError = evt.error?.message ?? evt.message ?? "Stream error";
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, idx).trimEnd();
              buffer = buffer.slice(idx + 1);
              if (line.startsWith("data:")) handle(line.slice(5).trim());
            }
          }
          if (buffer.startsWith("data:")) handle(buffer.slice(5).trim());

          if (streamError && !text) return fail(502, "upstream_error", String(streamError).slice(0, 300));

          const f = final as typeof final;
          const finish_reason =
            f?.status === "incomplete"
              ? f.incomplete_details?.reason === "max_output_tokens"
                ? "length"
                : (f.incomplete_details?.reason ?? "incomplete")
              : "stop";

          return json(200, { text, model: f?.model ?? MODEL, finish_reason, usage: f?.usage ?? null });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return new Response(null, { status: 499 });
          console.error("generate-edits failed", error);
          return fail(502, "upstream_unreachable", "Couldn't reach the AI service.");
        }
      },
    },
  },
});
