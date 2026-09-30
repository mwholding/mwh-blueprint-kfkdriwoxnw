// The registry as the home page needs it: each app's tile text, whether it is open or
// restricted, and whether the caller may open it right now (computed live, so a change in
// access management shows on the home page without a new sign-in). Deliberately narrow: never
// groups, members or permissions — every member may call it, unlike /api/Access.

const { getUserEmail } = require("../_shared/roles");
const { listAppModes, canUseAnyApp, DOOR_ROLE } = require("../_shared/access");

module.exports = async function (context, req) {
  const email = getUserEmail(req);
  if (!(await canUseAnyApp(email, [DOOR_ROLE]))) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }
  context.res = { headers: { "Cache-Control": "no-store" }, body: { apps: await listAppModes(email) } };
};
