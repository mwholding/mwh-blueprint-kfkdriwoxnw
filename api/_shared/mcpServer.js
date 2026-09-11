// Shared MCP JSON-RPC 2.0 responder for the intranet's MCP endpoints (api/Mcp, api/GigaMcp).
// One factory instead of two copies, because the fragile parts — the X-Mcp-Authorization
// workaround, the explicit Content-Type on every response, the notification/202 handling —
// must never drift apart between servers. Protocol notes (why no @modelcontextprotocol/sdk,
// no SSE, no session id) are in api/Mcp/index.js.

const { verifyToken } = require("./verifyToken");

// Newest first. `initialize` must answer with a version this server actually speaks: echoing
// the client's request back unconditionally (what this did before) claims support for anything
// it is asked for, and the spec relies on the answer being truthful so a client that can't
// speak it can disconnect instead of failing later on a shape it doesn't understand.
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

// Azure Functions only auto-sets Content-Type: application/json when a response has a plain
// object body AND no explicit headers at all — as soon as any header is set (e.g. Allow,
// WWW-Authenticate), it falls back to text/plain, which the MCP Streamable HTTP client
// refuses to parse. So every response here sets Content-Type explicitly.
function jsonRes(status, body, extraHeaders) {
  return { status, headers: { "Content-Type": "application/json", ...extraHeaders }, body };
}

// tools: the tools/list payload. callTool(name, args, email): returns a result or throws —
// a thrown Error becomes a tool-level error ({isError:true}), not a JSON-RPC error.
function createMcpHandler({ serverName, tools, callTool }) {
  return async function (context, req) {
    if (req.method === "GET" || req.method === "DELETE") {
      // This server doesn't support the SSE/session half of Streamable HTTP — 405 is the
      // documented fallback so clients stick to plain POST request/response.
      context.res = jsonRes(405, { error: "This server only supports stateless POST requests." }, { Allow: "POST" });
      return;
    }
    if (req.method !== "POST") {
      context.res = jsonRes(405, { error: "Method not allowed" });
      return;
    }

    // SWA's managed Functions app unconditionally overwrites the standard "Authorization"
    // header with its own internal SWA-to-Functions token before this code ever runs (a
    // documented SWA platform quirk, see github.com/Azure/static-web-apps/issues/158) — so
    // Langdock's real OAuth bearer token is sent via a custom header instead ("Custom Headers"
    // step in its MCP integration form: X-Mcp-Authorization: Bearer {{ access_token }}), which
    // SWA has no reason to touch. Falls back to the standard header for local `func start`
    // testing, where there's no SWA layer in front to interfere.
    const authHeader = req.headers["x-mcp-authorization"] || req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    let email;
    try {
      if (!token) throw new Error("Missing bearer token");
      const claims = await verifyToken(token);
      email = claims.preferred_username || claims.email || claims.upn;
      if (!email) throw new Error("Token has no email/UPN claim");
    } catch (err) {
      context.log(`MCP AUTH REJECTED: ${err.message}`);
      // MCP_DEBUG_AUTH surfaces the real rejection reason in the response body instead of just
      // the generic "Unauthorized" — turn this app setting off again once auth is confirmed
      // working, so failure details aren't exposed to callers permanently.
      const body =
        process.env.MCP_DEBUG_AUTH === "true" ? { error: "Unauthorized", reason: err.message } : { error: "Unauthorized" };
      context.res = jsonRes(401, body, { "WWW-Authenticate": "Bearer" });
      return;
    }

    const message = req.body;
    if (!message || typeof message.method !== "string") {
      context.res = jsonRes(400, { jsonrpc: "2.0", id: message?.id ?? null, error: { code: -32600, message: "Invalid Request" } });
      return;
    }

    const isNotification = message.id === undefined;
    const respond = (result) => {
      context.res = isNotification ? jsonRes(202, undefined) : jsonRes(200, { jsonrpc: "2.0", id: message.id, result });
    };
    const respondError = (code, msg) => {
      context.res = isNotification
        ? jsonRes(202, undefined)
        : jsonRes(200, { jsonrpc: "2.0", id: message.id, error: { code, message: msg } });
    };

    try {
      switch (message.method) {
        case "initialize": {
          const asked = message.params?.protocolVersion;
          respond({
            protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: serverName, version: "1.0.0" },
          });
          return;
        }
        case "notifications/initialized":
        case "notifications/cancelled":
          context.res = jsonRes(202, undefined);
          return;
        case "ping":
          respond({});
          return;
        case "tools/list":
          respond({ tools });
          return;
        case "tools/call": {
          const { name, arguments: args } = message.params ?? {};
          try {
            const result = await callTool(name, args ?? {}, email);
            context.log(`MCP TOOL ${email} ${name}`);
            // Text content stays the contract every client understands; structuredContent is
            // additive (2025-06-18) and only valid as an object, so arrays and scalars are
            // carried by the text block alone.
            const payload = { content: [{ type: "text", text: JSON.stringify(result) }], isError: false };
            if (result && typeof result === "object" && !Array.isArray(result)) payload.structuredContent = result;
            respond(payload);
          } catch (err) {
            respond({ content: [{ type: "text", text: err.message }], isError: true });
          }
          return;
        }
        default:
          respondError(-32601, `Method not found: ${message.method}`);
          return;
      }
    } catch (err) {
      context.log(`MCP ERROR: ${err.message}`);
      respondError(-32603, "Internal error");
    }
  };
}

module.exports = { createMcpHandler };
