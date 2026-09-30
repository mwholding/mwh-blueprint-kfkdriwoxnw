const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryStore, memoryFiles, load } = require("./helpers");

test("mutateJson re-reads and retries when another writer got in first", async () => {
  const store = memoryStore();
  const { mutateJson } = load("_shared/jsonDoc.js", { store });
  await store.writeJson("doc.json", { n: 0 });
  let runs = 0;
  await mutateJson("doc.json", async (data) => {
    runs += 1;
    if (runs === 1) await store.writeJson("doc.json", { n: 10 }); // someone else writes in between
    return { n: data.n + 1 };
  });
  assert.equal(runs, 2);
  assert.deepEqual(store.blobs.get("doc.json").data, { n: 11 });
});

test("mutateJson writes nothing when the change returns undefined", async () => {
  const store = memoryStore();
  const { mutateJson } = load("_shared/jsonDoc.js", { store });
  assert.equal((await mutateJson("doc.json", () => undefined)).written, false);
  assert.equal(store.blobs.has("doc.json"), false);
});

test("saveTracked refuses a stale document with a 409 instead of overwriting", async () => {
  const store = memoryStore();
  const { loadTracked, saveTracked } = load("_shared/jsonDoc.js", { store });
  await store.writeJson("doc.json", { items: [] });
  const mine = await loadTracked("doc.json");
  await store.writeJson("doc.json", { items: ["theirs"] });
  mine.items.push("mine");
  await assert.rejects(saveTracked("doc.json", mine), (err) => err.status === 409);
  assert.deepEqual(store.blobs.get("doc.json").data, { items: ["theirs"] });
});

test("two user apps created at the same time: one is saved, the other is told to retry", async () => {
  const store = memoryStore();
  const apps = load("_shared/user-apps/store.js", { store, files: memoryFiles() });
  const html = [{ path: "index.html", content: "<h1>Hi</h1>" }];
  await apps.createApp({ name: "First", files: html }, "a@example.com"); // the index exists from here on
  const results = await Promise.allSettled([
    apps.createApp({ name: "Second", files: html }, "a@example.com"),
    apps.createApp({ name: "Third", files: html }, "b@example.com"),
  ]);
  const saved = results.filter((r) => r.status === "fulfilled").length;
  const refused = results.filter((r) => r.status === "rejected" && r.reason.status === 409).length;
  assert.equal(saved + refused, 2);
  // The fresh index also holds the example app (Hello Langdock), plus "First".
  assert.equal(store.blobs.get("user-apps.json").data.items.length, 2 + saved, "nothing saved was lost");
});
