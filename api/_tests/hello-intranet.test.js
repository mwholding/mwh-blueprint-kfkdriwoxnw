const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryStore, load, request, invoke } = require("./helpers");

process.env.ACCESS_CACHE_MS = "0";

// The pattern every intranet app's tests follow: who may read, who may write, who gets nothing.
function setup(apps) {
  const store = memoryStore();
  if (apps) store.blobs.set("access.json", { data: { apps, groups: { greeters: { domains: [], permissions: [{ app: "hello-intranet", action: "write" }] } }, users: { "greeter@example.com": ["greeters"] } }, etag: "e0" });
  return { store, api: load("HelloIntranet/index.js", { store }) };
}

test("open by default: everyone who may sign in reads and says hello; the audit names them", async () => {
  const { store, api } = setup();
  const res = await invoke(api, request("anna@example.com", [], { method: "POST" }));
  assert.equal(res.body.count, 1);
  assert.equal(res.body.last.name, "anna", "never another person's full address");
  assert.equal(store.audit.find((e) => e.action === "hello").user, "anna@example.com");
  assert.equal((await invoke(api, request("ben@example.com", []))).body.count, 1);
});

test("restricted: only the group gets in; a stranger never does", async () => {
  const { api } = setup({
    intranet: { path: "/*", gated: false },
    "access-admin": { path: "/apps/access-admin/*", gated: true },
    "hello-intranet": { path: "/apps/hello-intranet/*", gated: true },
  });
  assert.equal((await invoke(api, request("anna@example.com", []))).status, 403);
  assert.equal((await invoke(api, request("greeter@example.com", [], { method: "POST" }))).body.count, 1);
  assert.equal((await invoke(api, request("someone@elsewhere.org", []))).status, 403);
});
