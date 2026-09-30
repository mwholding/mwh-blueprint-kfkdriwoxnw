// Access control for the whole site. One JSON document in Blob Storage (access.json, see
// jsonStore.js), edited in /apps/access-admin/: no file in git and no deploy to change who may
// do what. It holds three things:
//
//   apps    the registry: { <id>: { label, description, path, url, gated, showOnHome, order, status } }
//           One entry per app (and per permission without a page of its own). The entry is also
//           the app's tile on the home page.
//   groups  { <name>: { label, domains: [...], permissions: [{ app, action, scope? }] } }
//   users   { <email>: [<group name>, ...] }
//
// The rules, in full:
//   - Every app has ONE switch, `gated`. Open (gated: false): everyone who may sign in gets in,
//     at every level. Restricted (gated: true): only groups holding a permission for it.
//   - The front door (DOOR_ROLE, "intranet") is decided the same way. Whoever holds it is a
//     member: the home page with its tiles and the Langdock connection.
//   - Someone who may sign in but is not a member is an app-only guest: they get the open apps
//     and the apps a permission names, never the home page.
//   - An id with no registry entry grants nothing. Forgetting to register a new app therefore
//     shows up as an app nobody can open, never as one everybody can.
//   - The adminEmails in site.config.json hold every permission, whatever is stored.
//
// Two ways the rules are applied:
//   - Pages: at sign-in, /api/GetRoles hands out one SWA role per app the person may open
//     (getRolesForEmail). The route rule "/apps/<id>/*" requires role <id>. A change therefore
//     reaches pages at the person's next sign-in.
//   - APIs: every function asks canUseAnyApp / canUseApp / can live, so a change reaches the
//     APIs within ACCESS_CACHE_MS (30 seconds by default), without a new sign-in.

const { readJson, writeJson, appendAuditLine } = require("./jsonStore");
const { DOOR_ROLE, SIGNED_IN_ROLE, hasEmail, isConfiguredAdmin } = require("./config");

const BLOB = "access.json";
const AUDIT_BLOB = "access-audit.jsonl";

// What a fresh install starts from: the home page open to everyone who can sign in, access
// management restricted, and the example app Hello Intranet open. There is no seed script: until an
// admin saves in /apps/access-admin/ for the first time, this is the document the site behaves
// as if it had.
// The first save writes it to Blob Storage, and from then on the stored document is the only
// truth. ADMIN_EMAILS hold every permission regardless, which is what makes that first sign-in
// possible.
function defaultAccess() {
  return {
    updatedAt: null,
    updatedBy: null,
    apps: {
      // The front door. Open: an allowed email domain is enough to be a member. Restrict it
      // when the sign-in tenant holds many more people than should see the intranet; they can
      // still be given single apps.
      [DOOR_ROLE]: { label: "Intranet home page", description: "", path: "/*", url: "", gated: false, showOnHome: false, order: 0, status: "" },
      "access-admin": {
        label: "Access management",
        description: "Who may read or write what: groups, permissions, and which apps are open to everyone. No deploy needed to change access.",
        path: "/apps/access-admin/*", url: "", gated: true, showOnHome: true, order: 90, status: "",
      },
      // The example intranet app (apps/hello-intranet/): open, so everyone can try it.
      "hello-intranet": {
        label: "Hello Intranet",
        description: "An example of an intranet app: its own page, API, stored data and audit trail. Copy it to start your own.",
        path: "/apps/hello-intranet/*", url: "", gated: false, showOnHome: true, order: 50, status: "",
      },
    },
    groups: {},
    users: {},
  };
}

// read < write < admin: holding a higher one satisfies a lower check. Any other action string
// is an independent flag with no order.
const TIERS = { read: 0, write: 1, admin: 2 };

// One request can check permissions several times, so each Function instance keeps the parsed document for 30 seconds. App setting
// ACCESS_CACHE_MS changes that; 0 turns the cache off. A save clears it on the saving instance
// at once; other instances follow within the cache time. Access management always reads fresh.
let cache = null; // { at, promise }
const cacheMs = () => Number(process.env.ACCESS_CACHE_MS ?? 30 * 1000);

async function readStored() {
  try {
    const data = await readJson(BLOB);
    // Nothing stored yet: a fresh install, before the first save in the admin UI.
    if (!data) return defaultAccess();
    return { apps: {}, groups: {}, users: {}, ...data };
  } catch (err) {
    // Storage unreachable or not configured yet (e.g. local `func start` without the setting).
    // The defaults grant less than a real document, never more.
    return defaultAccess();
  }
}

async function loadAccess({ fresh = false } = {}) {
  if (fresh || !cache || Date.now() - cache.at >= cacheMs()) cache = { at: Date.now(), promise: readStored() };
  return structuredClone(await cache.promise);
}

async function saveAccess(data, email) {
  const now = new Date().toISOString();
  const next = { ...data, updatedAt: now, updatedBy: email };
  await writeJson(BLOB, next);
  cache = null;
  await appendAuditLine(AUDIT_BLOB, { ts: now, user: email });
  return next;
}

function domainOf(email) {
  return (email || "").toLowerCase().split("@").pop() ?? "";
}

const isRegistered = (apps, id) => !!(apps || {})[id];
const isOpenIn = (apps, id) => isRegistered(apps, id) && !apps[id].gated;

// Explicit group membership (users[email]) plus the groups whose domains include the caller's.
function resolveGroupNamesForEmail(access, email) {
  if (!email) return [];
  const lower = email.toLowerCase();
  const explicit = access.users[lower] ?? access.users[email] ?? [];
  const auto = Object.entries(access.groups)
    .filter(([, g]) => (g.domains ?? []).includes(domainOf(lower)))
    .map(([name]) => name);
  return [...new Set([...explicit, ...auto])];
}

function resolvePermissionsForEmail(access, email) {
  const perms = [];
  for (const name of resolveGroupNamesForEmail(access, email)) {
    perms.push(...(access.groups[name]?.permissions ?? []));
  }
  // The break-glass admins (adminEmails in site.config.json) hold everything, expressed as
  // ordinary permissions rather than as a special case inside every check.
  if (isConfiguredAdmin(email)) {
    for (const id of new Set([DOOR_ROLE, "access-admin", ...Object.keys(access.apps || {})])) {
      perms.push({ app: id, action: "admin" });
    }
  }
  return perms;
}

function scopeMatches(grantScope, wantScope) {
  if (!wantScope) return true; // the caller is not asking for a scoped check
  if (!grantScope) return true; // an unscoped grant covers every scope
  return Object.entries(wantScope).every(([k, v]) => grantScope[k] === v);
}

function permissionSatisfies(perm, app, action, scope) {
  if (perm.app !== app) return false;
  if (!scopeMatches(perm.scope, scope)) return false;
  if (perm.action === action) return true;
  const want = TIERS[action];
  const have = TIERS[perm.action];
  if (want === undefined || have === undefined) return false; // other actions: exact match only
  return have >= want;
}

// Member = may use the home page: the front door is open, or a permission grants it.
function isMemberIn(access, email) {
  if (!hasEmail(email) || !isRegistered(access.apps, DOOR_ROLE)) return false;
  if (isOpenIn(access.apps, DOOR_ROLE)) return true;
  return resolvePermissionsForEmail(access, email).some((p) => p.app === DOOR_ROLE);
}

function canUseAppIn(access, email, id, action) {
  if (!hasEmail(email) || !isRegistered(access.apps, id)) return false;
  if (id === DOOR_ROLE) return isMemberIn(access, email);
  if (isOpenIn(access.apps, id)) return true;
  return resolvePermissionsForEmail(access, email).some((p) => permissionSatisfies(p, id, action));
}

// ---- The checks endpoints use -------------------------------------------------------------

// May this person use app `id` at level `action`? Open app: everyone who may sign in, at every
// level. Restricted: the permission decides.
async function canUseApp(email, id, action = "read") {
  return canUseAppIn(await loadAccess(), email, id, action);
}

// The first check of every browser API: may the caller use at least one of the apps this
// endpoint serves? Record-level checks (scopes, owner, 404s) follow in the endpoint itself.
async function canUseAnyApp(email, ids, action = "read") {
  const access = await loadAccess();
  return ids.some((id) => canUseAppIn(access, email, id, action));
}

async function isMember(email) {
  return isMemberIn(await loadAccess(), email);
}

// A permission from a group, ignoring the open switch. Use it for what an open app must still
// not hand to everyone, typically "admin". CAREFUL without a scope: it means "in ANY scope",
// so a grant limited to one unit satisfies it. Never use it as a shortcut for "…in this unit".
async function can(email, app, action, scope) {
  if (!email) return false;
  const access = await loadAccess();
  if (!isRegistered(access.apps, app)) return false;
  return resolvePermissionsForEmail(access, email).some((p) => permissionSatisfies(p, app, action, scope));
}

// Add one named helper per question an app asks, rather than passing capability strings
// around: a typo in a string silently returns false, which reads as a permissions problem and
// costs an hour. For example, for a contract register where opening it lets everyone read but
// editing needs a group grant:
//
//   const canReadContracts  = (email) => canUseApp(email, "contracts", "read");
//   const canWriteContracts = (email) => can(email, "contracts", "write");

// Scoped permissions: a permission may carry a free-form scope object, so one app can be
// granted per unit — { app: "handbook", action: "write", scope: { unit: "north" } }. Nothing in
// this blueprint uses one yet. The pattern to copy resolves the list explicitly:
//
//   async function writableUnitsFor(email) {          // -> "all" | ["north", ...]
//     const access = await loadAccess();
//     const units = new Set();
//     for (const p of resolvePermissionsForEmail(access, email)) {
//       if (p.app !== "handbook" || !(TIERS[p.action] >= TIERS.write)) continue;
//       if (!p.scope) return "all";                   // an unscoped grant covers every unit
//       if (p.scope.unit) units.add(p.scope.unit);
//     }
//     return [...units];
//   }

// ---- Sign-in roles and the home page ------------------------------------------------------

// The SWA roles a person gets at sign-in:
//   - SIGNED_IN_ROLE for everyone allowed (shared design files, and reaching /api/*)
//   - DOOR_ROLE for members
//   - one role per app they may open: every open app with a page, plus every app a group grants
// Every /apps/<id>/ path has a permanent route rule requiring role <id> (generated by
// misc/access-generate-routes.js), so switching an app between open and restricted needs no deploy.
async function getRolesForEmail(email) {
  if (!hasEmail(email)) return [];
  const access = await loadAccess();
  const roles = new Set([SIGNED_IN_ROLE]);
  if (isMemberIn(access, email)) roles.add(DOOR_ROLE);
  for (const [id, entry] of Object.entries(access.apps || {})) {
    if (id === DOOR_ROLE || !entry.path) continue; // no page, no route to open
    if (canUseAppIn(access, email, id, "read")) roles.add(id);
  }
  // A grant with an action other than read/write/admin still opens the page.
  for (const p of resolvePermissionsForEmail(access, email)) {
    if (p.app !== DOOR_ROLE && isRegistered(access.apps, p.app) && access.apps[p.app].path) roles.add(p.app);
  }
  return [...roles];
}

// The /apps/<id>/ link of an entry: its own `url`, or the folder its route pattern names.
function linkOf(id, entry) {
  if (entry.url) return entry.url;
  const m = /^\/apps\/([^/*]+)\/\*$/.exec(entry.path || "");
  return m ? `/apps/${m[1]}/` : "";
}

// The registry as the home page needs it: labels, tile text, open or restricted, and whether
// this caller may open each app right now. No groups, members or permissions, so every member
// may read it (api/Apps).
async function listAppModes(email) {
  const access = await loadAccess();
  const out = {};
  for (const [id, entry] of Object.entries(access.apps || {})) {
    out[id] = {
      label: entry.label || id,
      description: entry.description || "",
      url: linkOf(id, entry),
      gated: !!entry.gated,
      showOnHome: !!entry.showOnHome,
      order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 1000,
      status: entry.status || "",
      allowed: canUseAppIn(access, email, id, "read"),
    };
  }
  return out;
}

// ---- Saving ---------------------------------------------------------------------------------

// Refuses a document that would lock the saving admin (and possibly everyone) out. Pure: it
// judges the *proposed* document before anything is written. api/Access answers 409 with it.
function selfLockoutReason(nextDoc, email) {
  const doc = { apps: nextDoc.apps || {}, groups: nextDoc.groups || {}, users: nextDoc.users || {} };
  if (!isRegistered(doc.apps, DOOR_ROLE)) {
    return `This would remove the "${DOOR_ROLE}" entry — nobody would be a member of the intranet after signing out.`;
  }
  if (!isRegistered(doc.apps, "access-admin")) {
    return "This would remove Access management itself — nobody could reopen it to restore access.";
  }
  if (!isMemberIn(doc, email)) {
    return `This would restrict the whole intranet without giving ${email} access to it. Put yourself in a group that grants "${DOOR_ROLE}" first.`;
  }
  if (!resolvePermissionsForEmail(doc, email).some((p) => permissionSatisfies(p, "access-admin", "admin"))) {
    return `This would remove your own access-admin permission (${email}) — keep yourself in an admin group.`;
  }
  return null;
}

module.exports = {
  DOOR_ROLE,
  TIERS,
  defaultAccess,
  loadAccess,
  saveAccess,
  resolveGroupNamesForEmail,
  resolvePermissionsForEmail,
  canUseApp,
  canUseAnyApp,
  isMember,
  can,
  getRolesForEmail,
  listAppModes,
  selfLockoutReason,
};
