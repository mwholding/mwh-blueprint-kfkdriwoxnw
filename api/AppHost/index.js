// Serves user apps ("vibe coding via Langdock") live from Blob Storage at /api/a/<slug>/…
// The httpTrigger uses a custom route ("a/{appId}/{*path}") — the first one in this repo.
// SWA's catch-all route rule forces a login before this runs, but per CLAUDE.md security rule 2 the
// function checks the role itself, and the per-app email allowlist on top.
//
// Only files listed in the requested version's manifest are served (userAppStore.readAppFile),
// so stray or half-pruned blobs are unreachable regardless of the request path.

const { getRoles, getUserEmail } = require("../_shared/roles");
const store = require("../_shared/userAppStore");

// Egress control, not XSS control: colleague-/LLM-written JS runs same-origin by accepted
// decision, but it cannot load external scripts, phone home to other origins, or be framed.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

function textRes(status, message) {
  return { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, body: message };
}

module.exports = async function (context, req) {
  if (!getRoles(req).includes("intranet")) {
    context.res = textRes(403, "Forbidden");
    return;
  }
  const email = getUserEmail(req) || "unknown";

  // Custom route when it resolves; query params as the permanent fallback (also what local
  // `func start` testing and a potential route-less deployment of this function use).
  const appId = context.bindingData?.appId ?? req.query.app;
  let path = context.bindingData?.path ?? req.query.file ?? "";
  if (!appId) {
    context.res = textRes(400, "Expected /api/a/<app>/<file> or ?app=<app>&file=<file>");
    return;
  }

  const app = await store.getApp(String(appId).toLowerCase());
  if (!app) {
    context.res = textRes(404, `No app called "${appId}" here.`);
    return;
  }
  if (!store.canAccess(app, email)) {
    context.res = textRes(403, `You don't have access to this app — ask ${app.owner}.`);
    return;
  }

  // Owner-only preview of an older version: /api/a/<slug>/_v/<n>/<file>. "_" cannot start a
  // stored file path, so this segment can never shadow an app file.
  let version = app.currentVersion;
  const preview = /^_v\/(\d+)(?:\/(.*))?$/.exec(path);
  if (preview) {
    if (!store.isOwner(app, email)) {
      context.res = textRes(403, `Only the owner (${app.owner}) can preview old versions.`);
      return;
    }
    version = Number(preview[1]);
    path = preview[2] ?? "";
  }

  // Root without a trailing slash would make the browser resolve relative URLs against
  // /api/a/ instead of the app folder — redirect once. x-ms-original-url carries what the
  // visitor actually typed (SWA rewrites the proxied URL).
  if (!path) {
    const original = req.headers["x-ms-original-url"] || req.url || "";
    const pathname = original ? new URL(original, "https://x").pathname : "";
    if (pathname && !pathname.endsWith("/")) {
      context.res = { status: 301, headers: { Location: pathname + "/" }, body: "" };
      return;
    }
    path = "index.html";
  }

  const file = await store.readAppFile(app, version, path);
  if (!file) {
    context.res = textRes(404, `"${path}" is not part of app "${app.id}" (v${version}).`);
    return;
  }

  const isHtml = file.contentType.startsWith("text/html");
  const headers = {
    "Content-Type": file.contentType,
    // Edits go live on reload; a minute of staleness on assets is acceptable.
    "Cache-Control": isHtml ? "no-store" : "private, max-age=60",
  };
  if (isHtml) {
    headers["Content-Security-Policy"] = CSP;
    headers["X-Frame-Options"] = "DENY";
  }
  context.res = { status: 200, headers, body: file.buffer, isRaw: true };
};
