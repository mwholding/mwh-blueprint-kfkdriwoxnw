// Scoped store for user apps (see api/_shared/userAppStore.js): each app's frontend may
// read/write/delete small JSON/text VALUES and binary FILES (PDF, images, spreadsheets, ...)
// under its own blob prefix. Any visitor who can open the app can also write — it is the app's
// shared state, not per user.
//
//   GET    /api/AppData?app=<id>                    -> { keys: [{key, size, contentType, modifiedAt}] }
//   GET    /api/AppData?app=<id>&key=<k>            -> the value or file bytes (stored content type)
//   PUT    /api/AppData?app=<id>&key=<k>            -> write raw body as a JSON/text value (max 1 MB)
//   PUT    /api/AppData?app=<id>&key=<k>&kind=file  -> write a file: JSON body { contentType, base64 } (max 8 MB)
//   DELETE /api/AppData?app=<id>&key=<k>            -> delete
//
// Values are stored as application/json or text/plain; files only as a strict allowlist of
// download/display types (never text/html or image/svg+xml) — so nothing served from here can
// execute as markup on the intranet origin. 300 keys per app, shared between values and files.

const { getRoles, getUserEmail } = require("../_shared/roles");
const store = require("../_shared/userAppStore");

module.exports = async function (context, req) {
  if (!getRoles(req).includes("intranet")) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }
  const email = getUserEmail(req) || "unknown";

  const appId = String(req.query.app ?? "").toLowerCase();
  const app = appId ? await store.getApp(appId) : null;
  if (!app) {
    context.res = { status: 404, body: { error: `Unknown app "${appId}" — pass ?app=<id>` } };
    return;
  }
  if (!store.canAccess(app, email)) {
    context.res = { status: 403, body: { error: `You don't have access to this app — ask ${app.owner}.` } };
    return;
  }

  const key = req.query.key;
  try {
    if (req.method === "GET" && !key) {
      context.res = { body: { keys: await store.dataList(app.id) } };
      return;
    }
    if (req.method === "GET") {
      const value = await store.dataRead(app.id, key);
      if (!value) {
        context.res = { status: 404, body: { error: `No value for key "${key}"` } };
        return;
      }
      // key is validated to safe chars in the store, so it's safe in the Content-Disposition
      // header. inline lets images/PDF display; the allowlisted content type + the global
      // nosniff header keep the browser from ever running it as markup.
      context.res = {
        status: 200,
        headers: {
          "Content-Type": value.contentType,
          "Content-Disposition": `inline; filename="${key}"`,
          "Cache-Control": "no-store",
        },
        body: value.buffer,
        isRaw: true,
      };
      return;
    }
    if (req.method === "PUT" || req.method === "POST") {
      if (req.query.kind === "file") {
        // Base64-in envelope, the same pattern as api/Attachments — avoids relying on binary
        // request bodies, which SWA managed functions handle inconsistently.
        let body = req.body;
        if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
        if (!body && req.rawBody) { try { body = JSON.parse(req.rawBody); } catch { body = null; } }
        const b64 = body && (body.base64 || body.dataBase64);
        if (!b64) {
          context.res = { status: 400, body: { error: 'Send a JSON body { "contentType": "...", "base64": "..." }' } };
          return;
        }
        const buffer = Buffer.from(String(b64), "base64");
        const result = await store.dataWriteFile(app.id, key, buffer, body.contentType, email);
        context.log(`APPDATA WRITE-FILE ${email} app=${app.id} key=${key} size=${buffer.length}`);
        context.res = { body: { ok: true, ...result } };
        return;
      }
      const raw = req.rawBody ?? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? ""));
      const buffer = Buffer.from(raw, "utf8");
      const declaredJson = (req.headers["content-type"] ?? "").includes("json");
      let contentType = "text/plain; charset=utf-8";
      if (declaredJson) {
        try {
          JSON.parse(raw);
          contentType = "application/json";
        } catch {
          /* declared JSON but isn't — store as text */
        }
      }
      await store.dataWrite(app.id, key, buffer, contentType, email);
      context.log(`APPDATA WRITE ${email} app=${app.id} key=${key} size=${buffer.length}`);
      context.res = { body: { ok: true, key, size: buffer.length, contentType } };
      return;
    }
    if (req.method === "DELETE") {
      await store.dataDelete(app.id, key, email);
      context.log(`APPDATA DELETE ${email} app=${app.id} key=${key}`);
      context.res = { body: { ok: true, key } };
      return;
    }
    context.res = { status: 405, body: { error: "Method not allowed" } };
  } catch (err) {
    context.res = { status: 400, body: { error: err.message } };
  }
};
