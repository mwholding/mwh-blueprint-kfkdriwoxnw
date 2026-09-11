// Access control for the whole site: groups of { app, action, scope? } permissions, assigned to
// users either explicitly (by email) or automatically (by email domain). One JSON document in
// Blob Storage (see jsonStore.js), edited in /apps/access-admin/ — no file in git, no deploy to
// change who may do what. Read by api/GetRoles (the roles a login gets) and, through the helpers
// at the bottom, by every endpoint that serves protected content: api/Wiki, api/Attachments,
// api/AiEdit, api/Audit, api/Search and api/Mcp.

const { readJson, writeJson, appendAuditLine } = require("./jsonStore");
const { DOOR_ROLE, isAllowedEmail, isConfiguredAdmin } = require("./config");

const BLOB = "access.json";
const AUDIT_BLOB = "access-audit.jsonl";

// `apps` is the registry of things that can be gated: { <id>: { label, path, gated } }.
// `path` is the SWA route pattern the id protects ("" for a permission with no page of its
// own). `gated` decides who holds the id's role — see getRolesForEmail below. The route rule
// itself is generated per app folder at deploy time by misc/generate-app-routes.js and never
// changes. An id with no entry here holds no role, so an app folder that nobody registered is
// closed rather than open: forgetting to register is then a visibly missing app, never a
// quietly exposed one.
//
// What a fresh install starts from. There is no seed script to run: until an admin saves in
// /apps/access-admin/ for the first time, this is the document the site behaves as if it had.
// The first save in the admin UI writes it to Blob Storage with whatever was changed, and from
// then on the stored document is the only truth. Everyone in ADMIN_EMAILS (config.js) holds
// every permission regardless, which is what makes that first sign-in possible.
function defaultAccess() {
  return {
    updatedAt: null,
    updatedBy: null,
    apps: {
      // The front door. Open means an allowed email domain is enough to be let in. Gate it in
      // the admin UI if the Entra tenant holds many more people than should reach the site.
      [DOOR_ROLE]: { label: "Intranet (whole site)", path: "/*", gated: false },
      // Restricted from the start: the app that hands out access.
      "access-admin": { label: "Access management", path: "/apps/access-admin/*", gated: true },
      // Restricted from the start, so the first pages written are not company-wide by accident.
      wiki: { label: "Knowledge base", path: "/apps/wiki/*", gated: true },
      // Open: it only ever lists the apps the visitor may already open.
      "my-apps": { label: "My apps", path: "/apps/my-apps/*", gated: false },
    },
    groups: {
      "wiki-writers": {
        label: "Knowledge base editors (read and write, browser and chat)",
        domains: [],
        permissions: [{ app: "wiki", action: "write" }],
      },
      "wiki-readers": {
        label: "Knowledge base readers",
        domains: [],
        permissions: [{ app: "wiki", action: "read" }],
      },
    },
    users: {},
  };
}

// read/write/admin are tiered (holding a higher one satisfies a lower check); any other action
// string is an independent flag with no implied order.
const TIERS = { read: 0, write: 1, admin: 2 };

// Is this app open to everyone signed in? Unregistered means closed.
function isOpenIn(apps, id) {
  const entry = (apps || {})[id];
  return !!entry && !entry.gated;
}

async function loadAccess() {
  try {
    const data = await readJson(BLOB);
    // Nothing stored yet: a fresh install, before the first save in the admin UI.
    if (!data) return defaultAccess();
    return Object.assign({ apps: {} }, data);
  } catch (err) {
    // Storage unreachable or not configured yet (e.g. local `func start` without the app
    // setting). The defaults are the safer answer than no permissions at all: GetRoles runs on
    // every login, and they grant less than a real document, never more.
    return defaultAccess();
  }
}

async function saveAccess(data, email) {
  const now = new Date().toISOString();
  const next = { ...data, updatedAt: now, updatedBy: email };
  await writeJson(BLOB, next);
  await appendAuditLine(AUDIT_BLOB, { ts: now, user: email });
  return next;
}

function domainOf(email) {
  return (email || "").toLowerCase().split("@").pop() ?? "";
}

// Explicit group membership (users[email]) union groups whose domains include the caller's.
function resolveGroupNamesForEmail(access, email) {
  if (!email) return [];
  const lower = email.toLowerCase();
  const domain = domainOf(lower);
  const explicit = access.users[lower] ?? access.users[email] ?? [];
  const auto = Object.entries(access.groups)
    .filter(([, g]) => (g.domains ?? []).includes(domain))
    .map(([name]) => name);
  return [...new Set([...explicit, ...auto])];
}

function resolvePermissionsForEmail(access, email) {
  const names = resolveGroupNamesForEmail(access, email);
  const perms = [];
  for (const name of names) {
    const group = access.groups[name];
    if (!group) continue;
    for (const p of group.permissions ?? []) perms.push(p);
  }
  // The break-glass admins from config.js hold everything: the front door, access management,
  // and admin on every registered app. Expressed as ordinary permissions rather than as a
  // special case inside every check, so there is exactly one permission model to reason about.
  if (isConfiguredAdmin(email)) {
    perms.push({ app: DOOR_ROLE, action: "admin" });
    perms.push({ app: "access-admin", action: "admin" });
    for (const id of Object.keys(access.apps || {})) perms.push({ app: id, action: "admin" });
  }
  return perms;
}

function scopeMatches(grantScope, wantScope) {
  if (!wantScope) return true; // caller isn't asking for a scoped check
  if (!grantScope) return true; // unscoped grant covers every scope
  return Object.entries(wantScope).every(([k, v]) => grantScope[k] === v);
}

function permissionSatisfies(perm, app, action, scope) {
  if (perm.app !== app) return false;
  if (!scopeMatches(perm.scope, scope)) return false;
  if (perm.action === action) return true;
  const wantTier = TIERS[action];
  const haveTier = TIERS[perm.action];
  if (wantTier === undefined || haveTier === undefined) return false; // custom actions: exact match only
  return haveTier >= wantTier;
}

async function can(email, app, action, scope) {
  if (!email) return false;
  const access = await loadAccess();
  const perms = resolvePermissionsForEmail(access, email);
  return perms.some((p) => permissionSatisfies(p, app, action, scope));
}

// The SWA roles a caller gets at login: the base "intranet" door role, one role per app
// they hold a permission for, plus one role per app the registry marks as open.
//
// The open-app part is what makes "open vs restricted" a runtime decision. Every /apps/<name>/
// path has a permanent route rule requiring role <name> (generated by
// misc/generate-app-routes.js), so handing that role to every allowed-domain user reproduces
// exactly what the "/*" catch-all used to do — and taking it away, by flipping the app to
// gated in the admin UI, restricts the path at the user's next login with no deploy.
//
// An app folder with no registry entry hands out no role at all, so a new app is unreachable
// until it is registered in /apps/access-admin/ — see ADDING-AN-APP.md.
async function getRolesForEmail(email) {
  if (!isAllowedEmail(email)) return [];
  const access = await loadAccess();
  const apps = access.apps || {};
  const roles = new Set();
  const perms = resolvePermissionsForEmail(access, email);

  for (const p of perms) {
    if (p.app) roles.add(p.app);
  }

  // The base door role is a registry entry like any other: open (the default) means every
  // allowed-domain user gets it, exactly as before. Restricting it is how "an allowed email
  // domain is no longer enough to be let in" gets expressed — it gates the catch-all route AND
  // every API function, since they all check this one role.
  if (isOpenIn(apps, DOOR_ROLE)) roles.add(DOOR_ROLE);

  // Registered as open. Only things with a page to open — a permission-only id (path: "") has
  // no route to guard, so handing out its role would just be noise.
  for (const [id, entry] of Object.entries(apps)) {
    if (!entry.gated && entry.path) roles.add(id);
  }

  return [...roles];
}

// Effective access mode per registered app id, for the homepage tiles: open to all staff or
// restricted to groups. Contains no group or user data, so any signed-in member of staff may
// read it (see api/Apps).
async function listAppModes() {
  const access = await loadAccess();
  const apps = access.apps || {};
  const out = {};
  for (const [id, entry] of Object.entries(apps)) {
    out[id] = { label: entry.label || id, path: entry.path, gated: !!entry.gated };
  }
  return out;
}

// True when nobody needs a permission for this app — used by endpoints that guard a part of a
// page rather than a route of their own (api/BrandProfiles), so "open" keeps meaning "everyone".
async function appIsOpen(id) {
  const access = await loadAccess();
  return isOpenIn(access.apps, id);
}

// Open app -> anyone signed in; restricted -> the permission decides.
async function canUseApp(email, id, action) {
  const access = await loadAccess();
  if (isOpenIn(access.apps, id)) return true;
  return resolvePermissionsForEmail(access, email).some((p) => permissionSatisfies(p, id, action));
}

// Guard against an admin saving a document that locks them (and therefore possibly everyone)
// out: restricting the whole intranet, or dropping their own access-admin permission, would
// leave no way back into this app. Pure — it judges the *proposed* document, before writing.
function selfLockoutReason(nextDoc, email) {
  const doc = { apps: nextDoc.apps || {}, groups: nextDoc.groups || {}, users: nextDoc.users || {} };
  const perms = resolvePermissionsForEmail(doc, email);
  if (!isOpenIn(doc.apps, DOOR_ROLE) && !perms.some((p) => p.app === DOOR_ROLE)) {
    return `This would restrict the whole intranet without giving ${email} access to it — you would be locked out with no way back in. Put yourself in a group that grants "${DOOR_ROLE}" first.`;
  }
  if (!perms.some((p) => permissionSatisfies(p, "access-admin", "admin"))) {
    return `This would remove your own access-admin permission (${email}) — nobody could reopen this app. Keep yourself in an admin group.`;
  }
  return null;
}

// Named helpers rather than a stringly-typed hasCapability("wiki:write"): a typo in a capability
// string silently returns false (deny), which looks like a permission problem and costs an hour.
// One function per question, no parsing. Add one per app that serves protected content.
async function canWriteWiki(email) {
  return can(email, "wiki", "write");
}

// Reading the knowledge base is a permission like any other — { app: "wiki", action: "read" },
// implied by { app: "wiki", action: "write" }. The route rule only covers the /apps/wiki/ page;
// every endpoint that can surface a page's content (the app's API, search, the audit trail, an
// attachment URL, an MCP tool) has to ask this itself, or the page gate is decorative.
async function canReadWiki(email) {
  return can(email, "wiki", "read");
}

// Scoped permissions: a permission may carry a free-form scope object, so one app can be
// granted per unit — { app: "processes", action: "write", scope: { unit: "north" } }. Nothing in
// this blueprint uses a scope yet; the machinery above supports it, and the pattern to copy is:
//
//   async function writableUnitsFor(email) {          // -> "all" | ["north", ...]
//     const access = await loadAccess();
//     const units = new Set();
//     for (const p of resolvePermissionsForEmail(access, email)) {
//       if (p.app !== "processes") continue;
//       if (TIERS[p.action] === undefined || TIERS[p.action] < TIERS.write) continue;
//       if (!p.scope) return "all";                   // unscoped grant covers every unit
//       if (p.scope.unit) units.add(p.scope.unit);
//     }
//     return [...units];
//   }
//
// CAREFUL with can(email, app, action) and no scope: it means "in ANY scope", so a grant limited
// to one unit satisfies it. Never use it as a shortcut for "…in this unit" — resolve the list
// explicitly, the way the example does.

module.exports = {
  defaultAccess,
  loadAccess,
  saveAccess,
  resolveGroupNamesForEmail,
  can,
  getRolesForEmail,
  listAppModes,
  appIsOpen,
  canUseApp,
  selfLockoutReason,
  DOOR_ROLE,
  TIERS,
  resolvePermissionsForEmail,
  canReadWiki,
  canWriteWiki,
};
