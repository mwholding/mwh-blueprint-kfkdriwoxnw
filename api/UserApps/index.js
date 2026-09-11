// Read-only directory feed for /apps/my-apps/: the user apps the caller may open. Management
// (create/edit/rollback/access/delete) happens exclusively through Langdock via /api/Mcp.

const { getRoles, getUserEmail } = require("../_shared/roles");
const store = require("../_shared/userAppStore");

module.exports = async function (context, req) {
  if (!getRoles(req).includes("intranet")) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }
  const email = getUserEmail(req) || "unknown";

  let apps;
  try {
    apps = await store.listApps(email);
  } catch (err) {
    // No storage account configured (demo deployments) — an empty directory is the honest answer.
    context.res = { body: { apps: [], unavailable: true } };
    return;
  }

  context.res = {
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
