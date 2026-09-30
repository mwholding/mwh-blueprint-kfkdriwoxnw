// The API of the example intranet app /apps/hello-intranet/ — the smallest complete pattern
// to copy for a new app:
//
//   1. check that the caller may use the app at all (canUseAnyApp), live, on every request
//   2. check the level the action needs (here: saying hello needs "write"; the app is open
//      in the default registry, and open means every level, so everyone may)
//   3. change the stored JSON document with mutateJson (never a blind write)
//   4. append an audit line with the user and a timestamp
//
//   GET   -> { count, last: { name, at } | null, canWrite }
//   POST  -> the same, after adding one hello

const { getUserEmail } = require("../_shared/roles");
const { canUseAnyApp, canUseApp } = require("../_shared/access");
const { readJson, appendAuditLine } = require("../_shared/jsonStore");
const { mutateJson } = require("../_shared/jsonDoc");

const APP = "hello-intranet";
const BLOB = "hello-intranet.json";
const AUDIT_BLOB = "hello-intranet-audit.jsonl";

// Only what the page needs: never another person's full address.
const view = (doc, canWrite) => ({
  count: doc?.count || 0,
  last: doc?.last ? { name: String(doc.last.email).split("@")[0], at: doc.last.at } : null,
  canWrite,
});

module.exports = async function (context, req) {
  const email = getUserEmail(req);
  if (!(await canUseAnyApp(email, [APP]))) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }
  const canWrite = await canUseApp(email, APP, "write");

  try {
    if (req.method === "GET") {
      context.res = { headers: { "Cache-Control": "no-store" }, body: view(await readJson(BLOB), canWrite) };
      return;
    }
    if (req.method === "POST") {
      if (!canWrite) {
        context.res = { status: 403, body: { error: "You may look, but not say hello." } };
        return;
      }
      const at = new Date().toISOString();
      const { data } = await mutateJson(BLOB, (doc) => ({ count: (doc?.count || 0) + 1, last: { email, at } }));
      await appendAuditLine(AUDIT_BLOB, { ts: at, user: email, action: "hello", count: data.count, channel: req.channel || "browser" });
      context.res = { body: view(data, canWrite) };
      return;
    }
    context.res = { status: 405, body: { error: "Method not allowed" } };
  } catch (err) {
    context.log(`HELLO-INTRANET ${email} ${err.message}`);
    context.res = { status: 503, body: { error: "Storage is not available right now." } };
  }
};
