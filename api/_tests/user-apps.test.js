const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryStore, memoryFiles, load, request, invoke } = require("./helpers");

process.env.ACCESS_CACHE_MS = "0";

const html = [{ path: "index.html", content: "<h1>Hi</h1>" }];

function setup() {
  const store = memoryStore();
  const files = memoryFiles();
  const apps = load("_shared/user-apps/store.js", { store, files });
  const host = require("../AppHost");
  return { apps, host };
}

test("a new app is private; the owner opens it, a colleague gets 404", async () => {
  const { apps, host } = setup();
  await apps.createApp({ name: "Room booking", files: html }, "owner@example.com");
  const owner = await invoke(host, request("owner@example.com", ["signed-in"]), { appId: "room-booking", path: "" });
  assert.equal(owner.status, 200);
  const other = await invoke(host, request("other@example.com", ["signed-in"]), { appId: "room-booking", path: "" });
  assert.equal(other.status, 404, "404, so private app names cannot be probed");
});

test("an app shared by email opens for an app-only guest without the intranet role", async () => {
  const { apps, host } = setup();
  await apps.createApp({ name: "Room booking", files: html, accessMode: "restricted", accessEmails: ["guest@example.com"] }, "owner@example.com");
  const guest = await invoke(host, request("guest@example.com", ["signed-in"]), { appId: "room-booking", path: "" });
  assert.equal(guest.status, 200);
});

test("only the owner may delete from the home page", async () => {
  const { apps } = setup();
  const api = require("../UserApps");
  await apps.createApp({ name: "Room booking", files: html, accessMode: "domain" }, "owner@example.com");
  const del = (email) => invoke(api, request(email, ["signed-in", "intranet"], { method: "DELETE", query: { id: "room-booking" } }));
  assert.equal((await del("other@example.com")).status, 403);
  assert.equal((await del("owner@example.com")).body.ok, true);
  assert.equal(await apps.getApp("room-booking"), null);
});
