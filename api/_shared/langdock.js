// The single place this intranet talks to a language model: a thin wrapper around Langdock's
// OpenAI-compatible chat completions endpoint (docs.langdock.com/api-endpoints/completion/openai),
// "eu" region for data residency. Node's built-in fetch, no dependency.
//
// Every AI feature goes through here (api/AppAI for the user apps, api/AiEdit for the knowledge
// base), which is what keeps the API key server-side: no browser ever sees it. Swapping the
// provider for another OpenAI-compatible endpoint is a change to this file and two app settings,
// nothing else.
//
// App settings: LANGDOCK_API_KEY (required), LANGDOCK_ENDPOINT and LANGDOCK_MODEL (optional
// overrides).

const ENDPOINT = process.env.LANGDOCK_ENDPOINT || "https://api.langdock.com/openai/eu/v1/chat/completions";
const DEFAULT_MODEL = process.env.LANGDOCK_MODEL || "gpt-5.6-terra";

// Either { system, user } for a one-shot call, or { system, messages } for a multi-turn
// conversation. `messages` wins when both are given.
async function chatComplete({ system, user, messages, model = DEFAULT_MODEL, temperature = 0.3, maxTokens }) {
  const apiKey = process.env.LANGDOCK_API_KEY;
  if (!apiKey) throw new Error("LANGDOCK_API_KEY is not configured");

  const turns = Array.isArray(messages) && messages.length
    ? messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "") }))
    : [{ role: "user", content: user }];

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature,
      // Optional output cap; callers that omit it (AiEdit, vendor chat) keep the model default.
      ...(Number.isFinite(maxTokens) ? { max_tokens: maxTokens } : {}),
      messages: [{ role: "system", content: system }, ...turns],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Langdock request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

module.exports = { chatComplete };
