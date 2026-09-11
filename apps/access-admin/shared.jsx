/* shared.jsx — vocabulary, the store, and a client-side mirror of the resolution rules in
   api/_shared/access.js (so "effective access" can be shown without a round-trip per edit).
   Keep the two in sync if the resolution rules ever change. */
const { useState, useEffect, useCallback, useRef, useMemo } = React;

/* ---------- vocabulary ----------
   The list of gateable things is data, not a constant: it lives in access.json under `apps`
   and is edited in the Apps tab. Anything referenced by a permission but missing from the
   registry still shows up, so a grant can never become invisible. */
const appList = (apps) =>
  Object.keys(apps || {})
    .map((id) => Object.assign({ id }, apps[id]))
    .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));

const appLabelIn = (apps, id) => ((apps || {})[id] || {}).label || id;

const LEVELS = [
  { id: "read", label: "Read" },
  { id: "write", label: "Read & write" },
  { id: "admin", label: "Full admin" },
];
const TIERS = { read: 0, write: 1, admin: 2 };
const levelLabel = (id) => (LEVELS.find((l) => l.id === id) || {}).label || id;

/* Scoped permissions (optional, off by default).
   A permission may be limited to one unit — { app: "processes", action: "write",
   scope: { unit: "north" } }. To offer that in this UI, list the app ids that are scoped
   and the units to choose from; both empty means the scope picker never appears, which is
   the state this blueprint ships in. The API side is api/_shared/access.js. */
const SCOPED_APPS = [];
const BRANDS = [
  // { id: "north", label: "Northern region" },
];
const brandLabel = (id) => (BRANDS.find((b) => b.id === id) || {}).label || id;

/* ---------- resolution (mirrors api/_shared/access.js) ---------- */
function domainOf(email) {
  return (email || "").toLowerCase().split("@").pop() || "";
}

function autoGroupsFor(email, groups) {
  const domain = domainOf(email);
  return Object.keys(groups).filter((n) => (groups[n].domains || []).includes(domain)).sort();
}

function resolvePermissions(email, groups, users) {
  const explicit = users[(email || "").toLowerCase()] || [];
  const names = Array.from(new Set([...explicit, ...autoGroupsFor(email, groups)]));
  const out = [];
  names.forEach((name) => {
    const g = groups[name];
    if (!g) return;
    (g.permissions || []).forEach((p) => out.push(Object.assign({ via: name }, p)));
  });
  return out;
}

/* Collapse a person's grants into one row per app: highest level held, plus where it came from. */
function effectiveByApp(email, groups, users) {
  const byApp = {};
  resolvePermissions(email, groups, users).forEach((p) => {
    if (!p.app) return;
    if (!byApp[p.app]) byApp[p.app] = { app: p.app, best: null, grants: [] };
    const e = byApp[p.app];
    e.grants.push(p);
    const tier = TIERS[p.action];
    if (tier !== undefined && (e.best === null || tier > e.best)) e.best = tier;
  });
  return Object.values(byApp).sort((a, b) => a.app.localeCompare(b.app));
}

const tierName = (n) => (n === 2 ? "admin" : n === 1 ? "write" : "read");

function scopeText(scope) {
  if (!scope) return "";
  return Object.entries(scope)
    .map(([k, v]) => (k === "brand" ? brandLabel(v) : `${k}=${v}`))
    .join(", ");
}

const groupNames = (groups) => Object.keys(groups).sort();
const membersOf = (name, users) => Object.keys(users).filter((e) => (users[e] || []).includes(name)).sort();

/* Registry ∪ every app referenced by a permission, so no grant is ever hidden. */
function allAppIds(apps, groups) {
  const set = new Set(Object.keys(apps || {}));
  Object.values(groups).forEach((g) => (g.permissions || []).forEach((p) => p.app && set.add(p.app)));
  return Array.from(set).sort();
}

/* Apps every signed-in member of staff can open: registered, not gated, and with a page of
   their own — a permission-only id has nothing to open. Mirrors the open-app half of
   getRolesForEmail in api/_shared/access.js. */
function openAppIds(apps) {
  return Object.keys(apps || {})
    .filter((id) => apps[id].path && !apps[id].gated)
    .sort();
}

/* An id used by a permission but never registered — surfaced in the UI so it can be adopted. */
function unregisteredAppIds(apps, groups) {
  return allAppIds(apps, groups).filter((id) => !(apps || {})[id]);
}

/* "/apps/foo/" and "foo" both become the route pattern SWA expects. */
function normalisePath(input) {
  let p = (input || "").trim();
  if (!p) return "";
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/+$/, "");
  if (!p.endsWith("*")) p += "/*";
  return p;
}

/* A slug usable as both a role name and a registry key. */
function slugify(s) {
  return (s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/* Compare the registry against the route rules the API was deployed with.
   Every /apps/<id>/ folder gets a permanent rule requiring role <id> at deploy time, and who
   holds that role is decided at login — so open-vs-restricted needs no deploy. The only thing
   worth flagging here is a registered path with no rule at all, which happens for a path outside
   /apps/ (nothing generates those) or an app folder that hasn't been deployed yet.
   Returns null when the deployed rules are unknown. */
/* ---------- store ----------
   Source of truth is the server (/api/Access, Blob Storage). Edits are debounced: typing a
   label used to fire one PUT per keystroke, which is both wasteful and a good way to lose a
   change to an out-of-order response. */
function useAccessStore() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [saveState, setSaveState] = useState("idle"); // idle | pending | saving | saved | error
  const timer = useRef(null);
  const skipFirst = useRef(true);

  useEffect(() => {
    fetch("/api/Access")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        setData({
          apps: d.apps || {}, groups: d.groups || {}, users: d.users || {},
          updatedAt: d.updatedAt, updatedBy: d.updatedBy,
        });
        setLoaded(true);
      })
      .catch((status) => {
        setError(status === 403 ? "You don't have access-admin permissions." : "Could not load access data.");
        setLoaded(true);
      });
  }, []);

  const appsRef = data && data.apps;
  const groupsRef = data && data.groups;
  const usersRef = data && data.users;

  useEffect(() => {
    if (!data) return;
    if (skipFirst.current) { skipFirst.current = false; return; }
    setSaveState("pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSaveState("saving");
      fetch("/api/Access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apps: appsRef, groups: groupsRef, users: usersRef }),
      })
        .then((r) =>
          r.ok
            ? r.json()
            : // The server refuses saves that would lock the admin out (409) with an explanation
              // worth reading — a generic "could not save" would leave it a mystery.
              r.json().then(
                (body) => Promise.reject((body && body.error) || "Could not save — your last change is not stored."),
                () => Promise.reject("Could not save — your last change is not stored.")
              )
        )
        .then((saved) => {
          setError(null);
          setSaveState("saved");
          setData((d) => Object.assign({}, d, { updatedAt: saved.updatedAt, updatedBy: saved.updatedBy }));
        })
        .catch((reason) => {
          setSaveState("error");
          setError(typeof reason === "string" ? reason : "Could not save — your last change is not stored.");
        });
    }, 600);
    return () => clearTimeout(timer.current);
    // updatedAt/updatedBy come back from the save itself; depending on them would loop.
  }, [appsRef, groupsRef, usersRef]);

  const setApps = useCallback((fn) => {
    setData((d) => Object.assign({}, d, { apps: typeof fn === "function" ? fn(d.apps) : fn }));
  }, []);
  const setGroups = useCallback((fn) => {
    setData((d) => Object.assign({}, d, { groups: typeof fn === "function" ? fn(d.groups) : fn }));
  }, []);
  const setUsers = useCallback((fn) => {
    setData((d) => Object.assign({}, d, { users: typeof fn === "function" ? fn(d.users) : fn }));
  }, []);

  /* membership is stored on the user, but both the Groups and Users view edit it */
  const setMembership = useCallback((email, groupName, isMember) => {
    const e = (email || "").trim().toLowerCase();
    if (!e) return;
    setUsers((u) => {
      const cur = u[e] || [];
      const next = isMember ? Array.from(new Set([...cur, groupName])) : cur.filter((n) => n !== groupName);
      return Object.assign({}, u, { [e]: next });
    });
  }, [setUsers]);

  return { data, loaded, error, saveState, setApps, setGroups, setUsers, setMembership };
}

Object.assign(window, {
  appList, appLabelIn, LEVELS, levelLabel, TIERS, BRANDS, brandLabel, SCOPED_APPS,
  domainOf, autoGroupsFor, resolvePermissions, effectiveByApp, tierName, scopeText,
  groupNames, membersOf, allAppIds, unregisteredAppIds, openAppIds, normalisePath, slugify, useAccessStore,
});
