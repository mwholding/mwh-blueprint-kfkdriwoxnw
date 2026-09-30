const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryStore, memoryFiles, load, invoke } = require("./helpers");

process.env.ACCESS_CACHE_MS = "0";

// The tool calls behind api/Mcp, without the token check (that is api/_shared/verifyToken.js).
function tools(doc) {
  const store = memoryStore();
  if (doc) store.blobs.set("access.json", { data: doc, etag: "e0" });
  const userApps = load("_shared/user-apps/tools.js", { store, files: memoryFiles() });
  return { userApps, access: require("../_shared/access") };
}

test("the create and update descriptions stay short and point at the design guide", () => {
  const { userApps } = tools();
  for (const name of ["create_user_app", "update_user_app"]) {
    const d = userApps.TOOLS.find((t) => t.name === name).description;
    assert.ok(d.includes("get_user_app_guide"), name + " points at the guide");
    assert.ok(d.includes("/assets/app-kit.css"), name + " names the stylesheet");
    assert.ok(d.length < 5000, `${name} stays slim (${d.length} chars)`);
  }
});

test("get_user_app_guide returns the design guide, read-only", async () => {
  const { userApps } = tools();
  const tool = userApps.TOOLS.find((t) => t.name === "get_user_app_guide");
  assert.equal(tool.annotations.readOnlyHint, true);
  const { guide } = await userApps.call("get_user_app_guide", {}, "a@example.com");
  for (const needle of ["/assets/app-kit.css", "app-header", "--brand-accent", "empty", "375px"]) {
    assert.ok(guide.includes(needle), "guide mentions " + needle);
  }
});

test("a user app built in the chat is private to its owner", async () => {
  const { userApps } = tools();
  const app = await userApps.call("create_user_app", { name: "Room booking", files: [{ path: "index.html", content: "<h1>Hi</h1>" }] }, "owner@example.com");
  assert.equal(app.access.mode, "restricted");
  assert.deepEqual((await userApps.call("list_user_apps", {}, "other@example.com")).map((a) => a.id), ["hello-langdock"], "only the shared example");
  await assert.rejects(userApps.call("delete_user_app", { id: app.id }, "other@example.com"), /Only the owner/);
});

test("a fresh install has the Hello Langdock example, shared with everyone and owned by the first admin", async () => {
  const { userApps } = tools();
  const [example] = await userApps.call("list_user_apps", {}, "anyone@example.com");
  assert.equal(example.id, "hello-langdock");
  assert.equal(example.access.mode, "domain");
  assert.equal(example.owner, "you@example.com");
  assert.equal(example.owned, false);
  await userApps.call("delete_user_app", { id: "hello-langdock" }, "you@example.com");
  assert.deepEqual(await userApps.call("list_user_apps", {}, "anyone@example.com"), [], "deleted stays deleted");
});

test("the link the chat hands out uses the address the request came in on", async () => {
  const { userApps } = tools();
  const app = await userApps.call("create_user_app", { name: "Link check", files: [{ path: "index.html", content: "<h1>Hi</h1>" }] },
    "owner@example.com", { origin: "https://intranet.example.com" });
  assert.equal(app.url, "https://intranet.example.com/api/a/link-check/");
  assert.match(app.message, /Live now at https:\/\/intranet\.example\.com\/api\/a\/link-check\//);
});
