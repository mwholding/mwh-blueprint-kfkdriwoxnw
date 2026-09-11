// Thin HTTP wrapper around _shared/search.js — the permission filtering (the wiki read grant)
// lives there so the MCP `search` tool applies exactly the same rules.

const { getRoles, getUserEmail } = require("../_shared/roles");
const { search } = require("../_shared/search");

module.exports = async function (context, req) {
  if (!getRoles(req).includes("intranet")) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }

  context.res = { body: await search(getUserEmail(req), req.query.q) };
};
