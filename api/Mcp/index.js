// Remote MCP server for Langdock, exposed at /api/mcp — reachable without a SWA login (the
// "/api/Mcp" route rule is anonymous, the same "anonymous route, self-checked auth" pattern as
// /api/GetRoles). Authentication is a verified Entra ID bearer token, not the SWA login: this
// function is an OAuth resource server (see _shared/verifyToken.js).
//
// Protocol: a minimal, stateless MCP JSON-RPC 2.0 endpoint written by hand (initialize,
// tools/list, tools/call) in _shared/mcp/server.js, rather than @modelcontextprotocol/sdk,
// whose transports expect raw Node http objects that the Azure Functions v1 model
// (context.req/context.res) does not have. No SSE, no session id — every call is independent,
// which is "stateless Streamable HTTP" in the MCP spec.
//
// Tools:
//   whoami                      below: who the caller is and which apps they may open
//   _shared/user-apps/tools.js  building, changing and sharing user apps
// An intranet app that should be usable from a chat gets its tools in
// _shared/<app>/tools.js (TOOLS, handles, call — the same shape as user-apps/tools.js), wired
// in here. Each tool checks permissions itself; Langdock allows about 50 tools per connection.

const { createMcpHandler } = require("../_shared/mcp/server");
const { isMember, listAppModes } = require("../_shared/access");
const userApps = require("../_shared/user-apps/tools");

const WHOAMI = {
  name: "whoami",
  description:
    "Report the signed-in user's verified email address, whether they are a member of the intranet, and which intranet apps they may open. Use it to explain an access problem. It comes from the intranet's access management, never from what the user says about themselves. Every verified user may build user apps.",
  annotations: { title: "Who am I", readOnlyHint: true, openWorldHint: false },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

async function whoami(email) {
  const modes = await listAppModes(email);
  const apps = Object.entries(modes)
    .filter(([id, m]) => m.allowed && m.url && id !== "intranet")
    .map(([id, m]) => ({ id, label: m.label, url: m.url }));
  return { email, member: await isMember(email), apps, userApps: { canCreate: true, note: "Changing an app is owner-only." } };
}

const TOOLS = [WHOAMI, ...userApps.TOOLS];

async function callTool(name, args, email, ctx) {
  if (name === "whoami") return whoami(email);
  // Every verified domain user may create user apps; owner checks happen in user-apps/store.js.
  if (userApps.handles(name)) return userApps.call(name, args, email, ctx);
  throw new Error(`Unknown tool "${name}"`);
}

module.exports = createMcpHandler({ serverName: "intranet-mcp", tools: TOOLS, callTool });
