const { getUserEmail } = require("../_shared/roles");
const { loadAccess, saveAccess, can, selfLockoutReason } = require("../_shared/access");

module.exports = async function (context, req) {
  const email = getUserEmail(req);
  if (!(await can(email, "access-admin", "admin"))) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }

  if (req.method === "GET") {
    // On a fresh install this is the default document from _shared/access.js, not a stored
    // one: the admin edits it and the first save writes it. The UI needs no special case.
    context.res = { body: await loadAccess() };
    return;
  }

  if (req.method === "PUT") {
    const { groups, users, apps } = req.body ?? {};
    if (!groups || typeof groups !== "object" || !users || typeof users !== "object") {
      context.res = { status: 400, body: { error: "Expected { groups: {...}, users: {...}, apps?: {...} }" } };
      return;
    }
    // apps is optional so an older client can still save groups/users without wiping the registry.
    const registry = apps && typeof apps === "object" ? apps : (await loadAccess()).apps || {};

    // Refuse a save that would lock the saving admin out — restricting the whole intranet
    // without granting it to themselves, or dropping their own access-admin permission. Either
    // leaves nobody able to reopen this app, so it is worth blocking rather than auditing.
    const lockout = selfLockoutReason({ apps: registry, groups, users }, email);
    if (lockout) {
      context.log(`ACCESS SAVE REFUSED ${email} ${lockout}`);
      context.res = { status: 409, body: { error: lockout } };
      return;
    }
    const saved = await saveAccess({ apps: registry, groups, users }, email);
    context.log(
      `ACCESS SAVE ${email} apps=${Object.keys(registry).length} groups=${Object.keys(groups).length} users=${Object.keys(users).length}`
    );
    context.res = { body: saved };
    return;
  }

  context.res = { status: 405, body: { error: "Method not allowed" } };
};
