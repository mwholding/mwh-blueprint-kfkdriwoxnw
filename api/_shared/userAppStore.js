// User apps ("vibe coding via Langdock"): colleagues create small static apps (HTML/CSS/JS)
// through MCP tool calls; the files live in Blob Storage and are served live by api/AppHost —
// no git push, no redeploy. See CLAUDE.md "User Apps".
//
// Storage layout, mirroring contractStore.js (small index blob, bytes in separate blobs):
//   app-data container:       user-apps.json                   index (metadata only)
//                             user-apps-audit.jsonl            audit trail (mutations)
//                             user-app-data-audit.jsonl        audit trail (data API writes)
//   intranet-files container: user-app/<id>/v<n>/<path>        app files, one set per version
//                             user-app-data/<id>/<key>         data API values
//
// Invariants:
//   - `id` is a unique, permanent, name-derived slug (no random suffix) — it is the URL.
//   - `currentVersion` is ALWAYS the highest version number. Rollback copies an old
//     version's files into a NEW version, it never re-points. Pruning old versions can
//     therefore delete blobs without checking references.
//   - Every version physically holds all of its files (unchanged files are copied from the
//     previous version), so deleting a pruned version's prefix can never break a live one.
// Index writes are last-writer-wins on the whole blob, like every other store in this repo.

const { readJson, writeJson, appendAuditLine } = require("./jsonStore");
const { SITE_ORIGIN, ALIAS_DOMAINS } = require("./config");
const { putBlob, readBlob, deleteBlob, listBlobPaths } = require("./blobFiles");

const INDEX_BLOB = "user-apps.json";
const AUDIT_BLOB = "user-apps-audit.jsonl";
const DATA_AUDIT_BLOB = "user-app-data-audit.jsonl";
const FILE_PREFIX = "user-app";
const DATA_PREFIX = "user-app-data";

// Public origin of the intranet — used only to build the sharable URL the MCP tools hand back
// to a chat; serving itself is origin-relative. Set it in _shared/config.js.
const PUBLIC_ORIGIN = SITE_ORIGIN;

// Sized for LLM-generated single-file apps, which routinely reach 2–3 MB of HTML.
const MAX_FILES_PER_VERSION = 40;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_VERSION_BYTES = 24 * 1024 * 1024;
const MAX_VERSIONS_KEPT = 20;
const MAX_APPS_PER_OWNER = 50;
const MAX_DATA_KEYS = 300;
const MAX_DATA_VALUE_BYTES = 1024 * 1024;
const MAX_DATA_FILE_BYTES = 8 * 1024 * 1024;

// Content types an app may store as a file attachment and have served back from the intranet
// origin. Deliberately a strict allowlist of things that DOWNLOAD or display as data — never
// text/html, image/svg+xml, XML or any script type, because those would execute as markup on
// the (unsandboxed, same-origin) intranet if served back. octet-stream forces a download.
const DATA_FILE_TYPES = new Set([
  "application/pdf",
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "text/plain", "text/csv", "application/json",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel", "application/msword", "application/vnd.ms-powerpoint",
  "application/zip", "application/octet-stream",
]);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".woff2": "font/woff2",
};

const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DATA_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function contentTypeFor(filePath) {
  const dot = filePath.lastIndexOf(".");
  return dot === -1 ? null : CONTENT_TYPES[filePath.slice(dot).toLowerCase()] ?? null;
}

// The slug doubles as the app's permanent URL segment, so it must be stable and readable.
function slugify(name) {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function appUrl(id) {
  return `${PUBLIC_ORIGIN}/api/a/${id}/`;
}

// One person, two addresses: someone may appear in Langdock as <name>@one-domain and sign in to
// the intranet as <name>@another-domain. Addresses on the domains listed in config.js (same local
// part) count as the same identity for every ownership and access check, in both directions —
// otherwise nobody could open their own Langdock-built app in the browser. Audit lines and stored
// owner/access values keep the raw address that was actually used. Empty list = feature off.
function identityOf(email) {
  const e = String(email ?? "").toLowerCase();
  const at = e.lastIndexOf("@");
  const domain = at === -1 ? "" : e.slice(at + 1);
  return ALIAS_DOMAINS.includes(domain) ? `${e.slice(0, at)}@${ALIAS_DOMAINS[0]}` : e;
}

function sameUser(a, b) {
  return identityOf(a) === identityOf(b);
}

function isOwner(app, email) {
  return sameUser(app.owner, email);
}

function canAccess(app, email) {
  if (app.access?.mode !== "restricted") return true;
  return isOwner(app, email) || (app.access.emails ?? []).some((x) => sameUser(x, email));
}

function validatePath(filePath) {
  if (typeof filePath !== "string" || !filePath || filePath.length > 120) {
    throw new Error(`Invalid file path "${filePath}" (must be a relative path, max 120 chars)`);
  }
  const segments = filePath.split("/");
  if (segments.length > 4) throw new Error(`File path "${filePath}" has too many folders (max 4 levels)`);
  for (const seg of segments) {
    // Also excludes "..", leading dots and the reserved "_v" version-preview segment.
    if (!PATH_SEGMENT.test(seg)) throw new Error(`Invalid path segment "${seg}" in "${filePath}"`);
  }
  if (!contentTypeFor(filePath)) {
    throw new Error(
      `File type of "${filePath}" is not allowed. Allowed extensions: ${Object.keys(CONTENT_TYPES).join(" ")}`
    );
  }
  return filePath;
}

// files: [{path, content, encoding?}] from a tool call -> [{path, buffer, contentType}]
function decodeFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("files must be a non-empty array");
  const seen = new Set();
  return files.map((f) => {
    const path = validatePath(f.path);
    if (seen.has(path)) throw new Error(`Duplicate file path "${path}"`);
    seen.add(path);
    if (typeof f.content !== "string") throw new Error(`File "${path}" has no string content`);
    const buffer = f.encoding === "base64" ? Buffer.from(f.content, "base64") : Buffer.from(f.content, "utf8");
    if (buffer.length > MAX_FILE_BYTES) {
      throw new Error(`File "${path}" is ${buffer.length} bytes — the limit is ${MAX_FILE_BYTES / (1024 * 1024)} MB per file`);
    }
    return { path, buffer, contentType: contentTypeFor(path) };
  });
}

function validateManifest(fileEntries) {
  if (fileEntries.length === 0) throw new Error("An app version must contain at least one file");
  if (fileEntries.length > MAX_FILES_PER_VERSION) {
    throw new Error(`Too many files (${fileEntries.length}) — the limit is ${MAX_FILES_PER_VERSION} per version`);
  }
  if (!fileEntries.some((f) => f.path === "index.html")) {
    throw new Error('Every version needs an "index.html" at the root — it is the app\'s start page');
  }
  const total = fileEntries.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_VERSION_BYTES) {
    throw new Error(`Version totals ${total} bytes — the limit is ${MAX_VERSION_BYTES / (1024 * 1024)} MB per version`);
  }
  return total;
}

// Default is PRIVATE: a new app without an explicit accessMode is restricted to its owner.
// Sharing is a deliberate act — either "domain" (every signed-in intranet user) or
// "restricted" plus named email addresses. There is no third option.
function normalizeAccess(mode, emails) {
  if (mode !== undefined && mode !== "domain" && mode !== "restricted") {
    throw new Error('accessMode must be "domain" or "restricted"');
  }
  if (mode === "domain") return { mode: "domain" };
  const list = (emails ?? []).map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes("@"));
  return { mode: "restricted", emails: [...new Set(list)] };
}

async function loadIndex() {
  return (await readJson(INDEX_BLOB)) ?? { items: [] };
}

function findApp(index, id) {
  const app = index.items.find((a) => a.id === id);
  if (!app) throw new Error(`App "${id}" not found`);
  return app;
}

function requireOwner(app, email) {
  if (!isOwner(app, email)) throw new Error(`Only the owner (${app.owner}) can change app "${app.id}"`);
}

function blobPathFor(appId, version, filePath) {
  return `${FILE_PREFIX}/${appId}/v${version}/${filePath}`;
}

async function audit(entry) {
  await appendAuditLine(AUDIT_BLOB, { ts: new Date().toISOString(), channel: "langdock", ...entry });
}

// Writes a complete new version: `changed` are freshly uploaded buffers, `carried` are file
// entries copied byte-for-byte from a previous version so the new version is self-contained.
async function writeVersion(appId, version, changed, carried, fromVersionOf) {
  for (const f of changed) {
    await putBlob(blobPathFor(appId, version, f.path), f.buffer, f.contentType);
  }
  for (const f of carried) {
    const src = await readBlob(blobPathFor(appId, fromVersionOf(f), f.path));
    if (!src) throw new Error(`Stored file "${f.path}" is missing — try replaceAll with the full file set`);
    await putBlob(blobPathFor(appId, version, f.path), src.buffer, f.contentType);
  }
}

async function pruneVersions(app) {
  while (app.versions.length > MAX_VERSIONS_KEPT) {
    const dropped = app.versions.shift();
    const stale = await listBlobPaths(`${FILE_PREFIX}/${app.id}/v${dropped.n}/`);
    for (const blob of stale) await deleteBlob(blob.path);
  }
}

async function createApp({ name, description, icon, files, accessMode, accessEmails }, email) {
  const owner = String(email).toLowerCase();
  const id = slugify(name);
  if (id.length < 2) throw new Error(`"${name}" does not produce a usable URL name — pick a longer name`);
  if (id === "assets" || id === "api") throw new Error(`"${id}" is a reserved name — pick another one`);

  const index = await loadIndex();
  if (index.items.some((a) => a.id === id)) {
    throw new Error(`The URL name "${id}" is already taken — pick a different app name`);
  }
  if (index.items.filter((a) => a.owner === owner).length >= MAX_APPS_PER_OWNER) {
    throw new Error(`You already own ${MAX_APPS_PER_OWNER} apps — delete one first`);
  }

  const decoded = decodeFiles(files);
  const manifest = decoded.map((f) => ({ path: f.path, size: f.buffer.length, contentType: f.contentType }));
  const totalBytes = validateManifest(manifest);
  await writeVersion(id, 1, decoded, [], () => 1);

  const now = new Date().toISOString();
  const app = {
    id,
    name: String(name),
    description: description ? String(description) : "",
    icon: icon ? String(icon).slice(0, 8) : "",
    owner,
    access: normalizeAccess(accessMode, accessEmails),
    currentVersion: 1,
    versions: [{ n: 1, createdAt: now, createdBy: owner, note: "created", totalBytes, files: manifest }],
    createdAt: now,
    updatedAt: now,
    updatedBy: owner,
  };
  index.items.push(app);
  await writeJson(INDEX_BLOB, index);
  await audit({ user: owner, action: "create", appId: id, version: 1, files: manifest.map((f) => f.path) });
  return app;
}

async function updateApp(id, { files, deletePaths, replaceAll, name, description, icon, note }, email) {
  const index = await loadIndex();
  const app = findApp(index, id);
  requireOwner(app, email);
  const now = new Date().toISOString();

  if (name !== undefined) app.name = String(name); // the slug/URL stays — it is the permanent id
  if (description !== undefined) app.description = String(description);
  if (icon !== undefined) app.icon = String(icon).slice(0, 8);

  const hasFileChange = (files && files.length) || (deletePaths && deletePaths.length) || replaceAll;
  if (hasFileChange) {
    const decoded = decodeFiles(files ?? []);
    const removed = new Set((deletePaths ?? []).map(validatePath));
    const changedPaths = new Set(decoded.map((f) => f.path));
    const current = app.versions.find((v) => v.n === app.currentVersion);
    const carried = replaceAll
      ? []
      : current.files.filter((f) => !changedPaths.has(f.path) && !removed.has(f.path));

    const manifest = [
      ...carried,
      ...decoded.map((f) => ({ path: f.path, size: f.buffer.length, contentType: f.contentType })),
    ];
    const totalBytes = validateManifest(manifest);

    const n = app.currentVersion + 1;
    await writeVersion(id, n, decoded, carried, () => current.n);
    app.versions.push({ n, createdAt: now, createdBy: String(email).toLowerCase(), note: note ? String(note) : "", totalBytes, files: manifest });
    app.currentVersion = n;
    await pruneVersions(app);
  }

  app.updatedAt = now;
  app.updatedBy = String(email).toLowerCase();
  await writeJson(INDEX_BLOB, index);
  await audit({
    user: app.updatedBy,
    action: hasFileChange ? "update" : "update-meta",
    appId: id,
    version: app.currentVersion,
    note: note ? String(note) : undefined,
  });
  return app;
}

async function rollbackApp(id, version, email) {
  const index = await loadIndex();
  const app = findApp(index, id);
  requireOwner(app, email);
  const source = app.versions.find((v) => v.n === Number(version));
  if (!source) {
    throw new Error(`Version ${version} of app "${id}" is not available (kept: ${app.versions.map((v) => v.n).join(", ")})`);
  }

  const now = new Date().toISOString();
  const n = app.currentVersion + 1;
  await writeVersion(id, n, [], source.files, () => source.n);
  app.versions.push({
    n,
    createdAt: now,
    createdBy: String(email).toLowerCase(),
    note: `rollback to v${source.n}`,
    totalBytes: source.totalBytes,
    files: source.files,
  });
  app.currentVersion = n;
  await pruneVersions(app);
  app.updatedAt = now;
  app.updatedBy = String(email).toLowerCase();
  await writeJson(INDEX_BLOB, index);
  await audit({ user: app.updatedBy, action: "rollback", appId: id, version: n, note: `from v${source.n}` });
  return app;
}

async function setAccess(id, { mode, emails }, email) {
  const index = await loadIndex();
  const app = findApp(index, id);
  requireOwner(app, email);
  app.access = normalizeAccess(mode, emails);
  app.updatedAt = new Date().toISOString();
  app.updatedBy = String(email).toLowerCase();
  await writeJson(INDEX_BLOB, index);
  await audit({ user: app.updatedBy, action: "set-access", appId: id, note: JSON.stringify(app.access) });
  return app;
}

async function deleteApp(id, email) {
  const index = await loadIndex();
  const app = findApp(index, id);
  requireOwner(app, email);
  index.items = index.items.filter((a) => a.id !== id);
  await writeJson(INDEX_BLOB, index);
  // File bytes are too large for an audit append block (4 MB cap), so the audit line keeps
  // the metadata and manifest; the bytes themselves are gone once the blobs are deleted.
  await audit({ user: String(email).toLowerCase(), action: "delete", appId: id, note: JSON.stringify({ ...app, versions: app.versions.map((v) => ({ n: v.n, files: v.files.map((f) => f.path) })) }) });
  for (const prefix of [`${FILE_PREFIX}/${id}/`, `${DATA_PREFIX}/${id}/`]) {
    for (const blob of await listBlobPaths(prefix)) await deleteBlob(blob.path);
  }
  return { ok: true, id };
}

async function listApps(email) {
  const index = await loadIndex();
  return index.items.filter((a) => canAccess(a, email));
}

async function getApp(id) {
  const index = await loadIndex();
  return index.items.find((a) => a.id === id) ?? null;
}

// Serves only files listed in the version's manifest, so stray or half-pruned blobs are
// unreachable no matter what path the request carries.
async function readAppFile(app, version, filePath) {
  const v = app.versions.find((x) => x.n === version);
  if (!v) return null;
  const entry = v.files.find((f) => f.path === filePath);
  if (!entry) return null;
  const blob = await readBlob(blobPathFor(app.id, version, filePath));
  if (!blob) return null;
  return { buffer: blob.buffer, contentType: entry.contentType };
}

// ---- scoped per-app data API (used by api/AppData) ----

function validateDataKey(key) {
  if (typeof key !== "string" || !DATA_KEY.test(key)) {
    throw new Error("Invalid key: use 1-128 chars of letters, digits, dot, dash or underscore, not starting with . _ or -");
  }
  return key;
}

function dataBlobPath(appId, key) {
  return `${DATA_PREFIX}/${appId}/${key}`;
}

async function dataList(appId) {
  const items = await listBlobPaths(`${DATA_PREFIX}/${appId}/`);
  return items.map((b) => ({
    key: b.path.slice(`${DATA_PREFIX}/${appId}/`.length),
    size: b.size,
    contentType: b.contentType,
    modifiedAt: b.modifiedAt,
  }));
}

async function dataRead(appId, key) {
  return readBlob(dataBlobPath(appId, validateDataKey(key)));
}

async function ensureKeyQuota(appId, key) {
  const existing = await dataList(appId);
  if (!existing.some((e) => e.key === key) && existing.length >= MAX_DATA_KEYS) {
    throw new Error(`App "${appId}" already has ${MAX_DATA_KEYS} keys — delete some first`);
  }
}

async function dataWrite(appId, key, buffer, contentType, email) {
  validateDataKey(key);
  if (buffer.length > MAX_DATA_VALUE_BYTES) {
    throw new Error(`Value is ${buffer.length} bytes — the limit is ${MAX_DATA_VALUE_BYTES / (1024 * 1024)} MB per key`);
  }
  await ensureKeyQuota(appId, key);
  await putBlob(dataBlobPath(appId, key), buffer, contentType);
  await appendAuditLine(DATA_AUDIT_BLOB, {
    ts: new Date().toISOString(),
    user: String(email).toLowerCase(),
    appId,
    key,
    action: "write",
    size: buffer.length,
  });
}

// Store a binary attachment (PDF, image, spreadsheet, ...) under the same key space, served
// back same-origin by api/AppData. The content type must be in DATA_FILE_TYPES; anything that
// could execute as markup on the intranet origin (html, svg, xml, script) is refused here.
async function dataWriteFile(appId, key, buffer, contentType, email) {
  validateDataKey(key);
  const ct = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (!DATA_FILE_TYPES.has(ct)) {
    throw new Error(`Content type "${contentType}" is not allowed as a file. Allowed: ${[...DATA_FILE_TYPES].join(", ")}`);
  }
  if (buffer.length > MAX_DATA_FILE_BYTES) {
    throw new Error(`File is ${buffer.length} bytes — the limit is ${MAX_DATA_FILE_BYTES / (1024 * 1024)} MB per key`);
  }
  await ensureKeyQuota(appId, key);
  const storeType = ct === "text/plain" || ct === "text/csv" ? `${ct}; charset=utf-8` : ct;
  await putBlob(dataBlobPath(appId, key), buffer, storeType);
  await appendAuditLine(DATA_AUDIT_BLOB, {
    ts: new Date().toISOString(),
    user: String(email).toLowerCase(),
    appId,
    key,
    action: "write-file",
    size: buffer.length,
    contentType: storeType,
  });
  return { key, size: buffer.length, contentType: storeType };
}

async function dataDelete(appId, key, email) {
  await deleteBlob(dataBlobPath(appId, validateDataKey(key)));
  await appendAuditLine(DATA_AUDIT_BLOB, {
    ts: new Date().toISOString(),
    user: String(email).toLowerCase(),
    appId,
    key,
    action: "delete",
  });
}

module.exports = {
  createApp,
  updateApp,
  rollbackApp,
  setAccess,
  deleteApp,
  listApps,
  getApp,
  readAppFile,
  canAccess,
  isOwner,
  contentTypeFor,
  appUrl,
  slugify,
  dataList,
  dataRead,
  dataWrite,
  dataWriteFile,
  dataDelete,
  MAX_FILE_BYTES,
  MAX_VERSION_BYTES,
  MAX_VERSIONS_KEPT,
  MAX_DATA_VALUE_BYTES,
  MAX_DATA_FILE_BYTES,
  MAX_DATA_KEYS,
};
