// Tells the homepage whether each app is open to all staff or restricted, so the tiles can show
// that without it being hardcoded in apps/apps.json. Read-only, and deliberately narrow: labels
// and an open/restricted flag, never groups, members or permissions — every signed-in member of
// staff may call it, unlike /api/Access which is access-admin only.

const { getRoles } = require("../_shared/roles");
const { listAppModes } = require("../_shared/access");

module.exports = async function (context, req) {
  if (!getRoles(req).includes("intranet")) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }
  context.res = { body: { apps: await listAppModes() } };
};
