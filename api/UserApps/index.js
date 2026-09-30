// The user apps on the home page: the ones the caller may open, plus delete for the owner.
// Creating and changing apps happens in a Langdock chat, through /api/Mcp. Members only, like
// the home page; an app-only guest opens a shared app from its link.
//
//   GET                       -> { apps: [...] }
//   DELETE ?id=<app id>       -> owner only; 404 for an app the caller cannot open at all

const { getUserEmail } = require("../_shared/roles");
const { canUseAnyApp, DOOR_ROLE } = require("../_shared/access");
const store = require("../_shared/user-apps/store");

module.exports = async function (context, req) {
  const email = getUserEmail(req) || "unknown";
  if (!(await canUseAnyApp(email, [DOOR_ROLE]))) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }

  if (req.method === "DELETE") {
    const id = String(req.query?.id || "");
    let app;
    try {
      app = id ? await store.getApp(id) : null;
    } catch {
      context.res = { status: 503, body: { error: "Storage unavailable" } };
      return;
    }
    if (!app || !store.canAccess(app, email)) {
      context.res = { status: 404, body: { error: "Not found" } };
      return;
    }
    if (!store.isOwner(app, email)) {
      context.res = { status: 403, body: { error: "Only the owner can delete this app" } };
      return;
    }
    context.res = { body: await store.deleteApp(id, email, "browser") };
    return;
  }

  let apps;
  try {
    apps = await store.listApps(email);
  } catch (err) {
    // No storage account configured (demo deployments) — an empty directory is the honest answer.
    context.res = { body: { apps: [], unavailable: true } };
    return;
  }

  context.res = {
    headers: { "Cache-Control": "no-store" },
    body: {
      apps: apps
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
        .map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          icon: a.icon,
          owner: a.owner,
          owned: store.isOwner(a, email),
          restricted: a.access?.mode === "restricted",
          updatedAt: a.updatedAt,
          url: `/api/a/${a.id}/`,
        })),
    },
  };
};
