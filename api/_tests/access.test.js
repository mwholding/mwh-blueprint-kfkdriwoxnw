const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryStore, load } = require("./helpers");

// The tests change access mid-test and expect it to apply at once.
process.env.ACCESS_CACHE_MS = "0";

// Allowed domain in site.config.json: example.com. Break-glass admin: you@example.com.
function storeWith(doc) {
  const store = memoryStore();
  store.blobs.set("access.json", { data: doc, etag: "e0" });
  return store;
}

const restrictedDoor = () => ({
  apps: {
    intranet: { path: "/*", gated: true },
    "access-admin": { path: "/apps/access-admin/*", gated: true },
    "room-finder": { path: "/apps/room-finder/*", gated: false },
    handbook: { path: "/apps/handbook/*", gated: false },
    planner: { path: "/apps/planner/*", gated: true },
  },
  groups: {
    staff: { domains: [], permissions: [{ app: "intranet", action: "read" }] },
    planners: { domains: [], permissions: [{ app: "planner", action: "write" }] },
  },
  users: { "guest@example.com": ["planners"], "member@example.com": ["staff"] },
});

test("an app-only guest gets their app and the open apps, never the home page", async () => {
  const access = load("_shared/access.js", { store: storeWith(restrictedDoor()) });
  const roles = await access.getRolesForEmail("guest@example.com");
  for (const role of ["signed-in", "planner", "room-finder", "handbook"]) assert.ok(roles.includes(role), role);
  assert.ok(!roles.includes("intranet"));
  assert.ok(!roles.includes("access-admin"));
  assert.equal(await access.isMember("guest@example.com"), false);
  assert.equal(await access.canUseApp("guest@example.com", "planner", "write"), true);
  assert.equal(await access.canUseApp("guest@example.com", "planner", "admin"), false);
  const modes = await access.listAppModes("guest@example.com");
  assert.equal(modes.planner.allowed, true);
  assert.equal(modes.intranet.allowed, false);
});

test("members get the home page; a principal without an email gets nothing", async () => {
  const access = load("_shared/access.js", { store: storeWith(restrictedDoor()) });
  assert.ok((await access.getRolesForEmail("member@example.com")).includes("intranet"));
  assert.ok(!(await access.getRolesForEmail("member@example.com")).includes("planner"));
  assert.deepEqual(await access.getRolesForEmail(""), []);
  assert.equal(await access.canUseAnyApp(null, ["room-finder"]), false);
});

test("an open app lets everyone in at every level; can() still asks for a grant", async () => {
  const access = load("_shared/access.js", { store: storeWith(restrictedDoor()) });
  assert.equal(await access.canUseApp("guest@example.com", "handbook", "write"), true);
  assert.equal(await access.can("guest@example.com", "handbook", "write"), false);
});

test("an app without a registry entry is closed, even with a leftover grant", async () => {
  const doc = restrictedDoor();
  delete doc.apps.planner;
  const access = load("_shared/access.js", { store: storeWith(doc) });
  assert.equal(await access.canUseApp("guest@example.com", "planner", "read"), false);
  assert.ok(!(await access.getRolesForEmail("guest@example.com")).includes("planner"));
});

test("the break-glass admin holds everything, whatever is stored", async () => {
  const doc = restrictedDoor();
  doc.users = {};
  const access = load("_shared/access.js", { store: storeWith(doc) });
  const roles = await access.getRolesForEmail("you@example.com");
  for (const role of ["intranet", "access-admin", "planner"]) assert.ok(roles.includes(role), role);
  assert.equal(await access.can("you@example.com", "access-admin", "admin"), true);
});

test("before the first save, the built-in defaults apply", async () => {
  const access = load("_shared/access.js");
  const roles = await access.getRolesForEmail("new@example.com");
  assert.ok(roles.includes("intranet"));
  assert.ok(!roles.includes("access-admin"), "access management starts restricted");
  assert.ok(roles.includes("hello-intranet"), "the example app is open");
});

test("a save that would lock the saving admin out is refused", async () => {
  const access = load("_shared/access.js");
  const doc = access.defaultAccess();
  doc.users["boss@example.com"] = [];
  doc.groups.admins = { domains: [], permissions: [{ app: "access-admin", action: "admin" }] };
  doc.users["boss@example.com"] = ["admins"];
  assert.equal(access.selfLockoutReason(doc, "boss@example.com"), null);
  assert.match(access.selfLockoutReason({ ...doc, apps: { ...doc.apps, intranet: { ...doc.apps.intranet, gated: true } } }, "boss@example.com"), /restrict the whole intranet/);
  assert.match(access.selfLockoutReason({ ...doc, users: {} }, "boss@example.com"), /access-admin permission/);
  const { "access-admin": _gone, ...withoutAdminApp } = doc.apps;
  assert.match(access.selfLockoutReason({ ...doc, apps: withoutAdminApp }, "boss@example.com"), /Access management/);
});

test("access.json is cached per instance, and a save clears the cache", async () => {
  process.env.ACCESS_CACHE_MS = "60000";
  try {
    const store = storeWith(restrictedDoor());
    const access = load("_shared/access.js", { store });
    assert.equal(await access.canUseApp("guest@example.com", "planner", "read"), true);
    const doc = restrictedDoor();
    doc.users = {};
    await store.writeJson("access.json", doc);
    assert.equal(await access.canUseApp("guest@example.com", "planner", "read"), true, "still cached");
    await access.saveAccess(doc, "you@example.com");
    assert.equal(await access.canUseApp("guest@example.com", "planner", "read"), false, "fresh after a save");
  } finally {
    process.env.ACCESS_CACHE_MS = "0";
  }
});
