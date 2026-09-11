// Read-only view of the append-only audit trails, surfaced in the browser UI as a collapsed
// panel at the bottom of each app. Blob names are the same literals the stores pass to
// appendAuditLine (wikiStore.js, userAppStore.js, ...). A new store that logs an audit trail is
// only readable once it is registered here — with its own permission check below if its entries
// can carry content, not just metadata.

const { getRoles, getUserEmail } = require("../_shared/roles");
const { canReadWiki } = require("../_shared/access");
const { readAuditLines } = require("../_shared/jsonStore");

const KINDS = {
  wiki: { blob: "wiki-audit.jsonl", idField: "pageId" },
  access: { blob: "access-audit.jsonl", idField: "user" },
  "user-app": { blob: "user-apps-audit.jsonl", idField: "appId" },
  "user-app-data": { blob: "user-app-data-audit.jsonl", idField: "appId" },
  "app-ai": { blob: "app-ai-audit.jsonl", idField: "appId" },
};


module.exports = async function (context, req) {
  if (!getRoles(req).includes("intranet")) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }

  const kind = KINDS[req.query.kind];
  if (!kind) {
    context.res = { status: 400, body: { error: `Expected ?kind=${Object.keys(KINDS).join("|")}` } };
    return;
  }
  if (req.query.kind === "access" && !getRoles(req).includes("access-admin")) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }
  // The wiki trail is not just metadata: deletePage records a full `snapshot` of the removed
  // page (wikiStore.js), so serving it needs the same read permission as the wiki itself.
  if (req.query.kind === "wiki" && !(await canReadWiki(getUserEmail(req)))) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }

  let lines;
  try {
    lines = await readAuditLines(kind.blob);
  } catch (err) {
    // No storage account configured (demo deployments) — an empty trail is the honest answer.
    context.res = { body: { entries: [], unavailable: true } };
    return;
  }

  // Optional exact-id filter (used when a specific record is open) — done before the limit is
  // applied so a busy audit log elsewhere can't push a record's own older entries out.
  const idParam = req.query.id || req.query.pageId || req.query.appId;
  if (idParam) lines = lines.filter((e) => e[kind.idField] === idParam);

  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const entries = lines.slice(-limit).reverse();
  context.res = { body: { entries } };
};
