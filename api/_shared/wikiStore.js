// Controlling wiki pages — one JSON blob holding all pages, following the jsonStore.js
// convention used by api/Systems and api/UseCases. Shared by api/Wiki (browser) and api/Mcp
// (Langdock). Blob/audit names stay "fpna-wiki*" even after the user-facing rename to
// "Controlling Wiki", to avoid a pointless data migration.
//
// `folder` is a "/"-separated path (e.g. "Guidelines/AI"), same idea as a filesystem path —
// arbitrary depth, but still just a string on each page, no separate folder-table. `folders`
// on the blob is a small explicit registry of folder paths that exist even with zero pages in
// them yet (otherwise an empty folder — one just created, or one just emptied by moving its
// last page out — couldn't be listed/browsed/renamed at all, since everything else about a
// folder's existence is derived from the pages that happen to reference it).

const { readJson, writeJson, appendAuditLine } = require("./jsonStore");
const crypto = require("crypto");

const BLOB = "wiki.json";
const AUDIT_BLOB = "wiki-audit.jsonl";
const DEFAULT_FOLDER = "General";

async function readData() {
  const data = await readJson(BLOB);
  return { items: data?.items ?? [], folders: data?.folders ?? [] };
}

async function listPages(folder, query) {
  const { items: all } = await readData();
  let items = all;
  if (folder) {
    // Browsing a folder shows only what's directly in it; searching within a folder also
    // reaches into its subfolders, since "search" implies "search everything under here".
    items = query ? items.filter((p) => p.folder === folder || p.folder.startsWith(folder + "/")) : items.filter((p) => p.folder === folder);
  }
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q) ||
        (p.tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  }
  return items;
}

// Full set of known folder paths — explicitly-created empty ones plus whatever's derived from
// pages — so a folder that's momentarily empty (just created, or just emptied out) still shows.
async function listFolders() {
  const { items, folders } = await readData();
  return Array.from(new Set([...folders, ...items.map((p) => p.folder || DEFAULT_FOLDER)])).sort();
}

async function createFolder(path, email, channel = "browser") {
  const trimmed = path?.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) throw new Error("Folder path is required");
  const { items, folders } = await readData();
  const allPaths = new Set([...folders, ...items.map((p) => p.folder || DEFAULT_FOLDER)]);
  if (allPaths.has(trimmed)) throw new Error(`Folder "${trimmed}" already exists`);
  const now = new Date().toISOString();
  await writeJson(BLOB, { items, folders: [...folders, trimmed] });
  await appendAuditLine(AUDIT_BLOB, { ts: now, user: email, action: "create-folder", folder: trimmed, channel });
  return { folder: trimmed };
}

async function getPage(id) {
  const items = await listPages();
  return items.find((p) => p.id === id) ?? null;
}

async function createPage({ title, content, tags, folder, email, channel = "browser" }) {
  const { items, folders } = await readData();
  const now = new Date().toISOString();
  const page = {
    id: crypto.randomUUID(),
    title,
    content,
    tags: tags ?? [],
    folder: folder?.trim() || DEFAULT_FOLDER,
    attachments: [],
    updatedBy: email,
    updatedAt: now,
  };
  items.push(page);
  await writeJson(BLOB, { items, folders });
  await appendAuditLine(AUDIT_BLOB, { ts: now, user: email, action: "create", pageId: page.id, title, channel });
  return page;
}

async function updatePage(id, { title, content, folder, tags, email, channel = "browser" }) {
  const { items, folders } = await readData();
  const page = items.find((p) => p.id === id);
  if (!page) throw new Error(`Wiki page ${id} not found`);
  const before = page.content;
  const titleBefore = page.title;
  const tagsBefore = page.tags ?? [];
  page.content = content;
  if (title?.trim()) page.title = title.trim();
  if (folder?.trim()) page.folder = folder.trim();
  if (tags !== undefined) page.tags = tags;
  page.updatedBy = email;
  page.updatedAt = new Date().toISOString();
  await writeJson(BLOB, { items, folders });
  // before/after kept in full so the audit panel can show a real diff for this specific edit,
  // not just "something changed" — each update line is a self-contained before/after pair.
  // Title/tag changes get their own before/after pair alongside the content one, so a
  // metadata-only edit (no content change) still shows up as more than a no-op diff.
  await appendAuditLine(AUDIT_BLOB, {
    ts: page.updatedAt,
    user: email,
    action: "update",
    pageId: id,
    title: page.title,
    channel,
    before,
    after: content,
    ...(page.title !== titleBefore ? { titleBefore, titleAfter: page.title } : {}),
    ...(JSON.stringify(page.tags ?? []) !== JSON.stringify(tagsBefore) ? { tagsBefore, tagsAfter: page.tags ?? [] } : {}),
  });
  return page;
}

// Rewrites the folder path on every page under `from` (itself or a descendant), and on every
// explicitly-registered folder under it — the only way to rename a folder, since `folder` is
// just a path string, not a stored entity. Renaming a parent also carries its subfolders along
// (e.g. renaming "A" to "A2" turns "A/B" into "A2/B" too).
async function renameFolder(from, to, email, channel = "browser") {
  const trimmedTo = to?.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmedTo) throw new Error("New folder name is required");
  const { items, folders } = await readData();
  const under = (p) => p === from || p.startsWith(from + "/");
  const rewrite = (p) => (p === from ? trimmedTo : trimmedTo + p.slice(from.length));
  const affected = items.filter((p) => under(p.folder || DEFAULT_FOLDER));
  const affectedFolders = folders.filter((f) => under(f));
  if (affected.length === 0 && affectedFolders.length === 0) throw new Error(`Folder "${from}" not found`);
  const now = new Date().toISOString();
  for (const p of affected) {
    p.folder = rewrite(p.folder || DEFAULT_FOLDER);
    p.updatedBy = email;
    p.updatedAt = now;
  }
  const newFolders = folders.map((f) => (under(f) ? rewrite(f) : f));
  await writeJson(BLOB, { items, folders: newFolders });
  await appendAuditLine(AUDIT_BLOB, { ts: now, user: email, action: "rename-folder", from, to: trimmedTo, count: affected.length, channel });
  return { from, to: trimmedTo, count: affected.length };
}

// Blocked while non-empty — "empty" means no pages and no registered subfolders anywhere
// under this path, not just directly in it, so deleting a parent can't silently orphan a
// subfolder's pages.
async function deleteFolder(name, email, channel = "browser") {
  const { items, folders } = await readData();
  const under = (p) => p === name || p.startsWith(name + "/");
  const count = items.filter((p) => under(p.folder || DEFAULT_FOLDER)).length;
  const subfolders = folders.filter((f) => f !== name && under(f));
  if (count > 0 || subfolders.length > 0) {
    const parts = [];
    if (count > 0) parts.push(`${count} page${count === 1 ? "" : "s"}`);
    if (subfolders.length > 0) parts.push(`${subfolders.length} subfolder${subfolders.length === 1 ? "" : "s"}`);
    throw new Error(`Folder "${name}" still has ${parts.join(" and ")} — move or delete them first`);
  }
  const ts = new Date().toISOString();
  await writeJson(BLOB, { items, folders: folders.filter((f) => f !== name) });
  await appendAuditLine(AUDIT_BLOB, { ts, user: email, action: "delete-folder", folder: name, channel });
  return { ok: true };
}

async function deletePage(id, email, channel = "browser") {
  const { items, folders } = await readData();
  const index = items.findIndex((p) => p.id === id);
  if (index === -1) throw new Error(`Wiki page ${id} not found`);
  const [deleted] = items.splice(index, 1);
  await writeJson(BLOB, { items, folders });
  const ts = new Date().toISOString();
  // Full snapshot in the audit line (not just the id) so the append-only log stays a real
  // recovery/history trail even though the live dataset does a hard delete.
  await appendAuditLine(AUDIT_BLOB, { ts, user: email, action: "delete", pageId: id, snapshot: deleted, channel });
  return deleted;
}

async function addAttachment(pageId, attachment) {
  const { items, folders } = await readData();
  const page = items.find((p) => p.id === pageId);
  if (!page) throw new Error(`Wiki page ${pageId} not found`);
  page.attachments = [...(page.attachments ?? []), attachment];
  await writeJson(BLOB, { items, folders });
  return page;
}

async function removeAttachment(pageId, attachmentId) {
  const { items, folders } = await readData();
  const page = items.find((p) => p.id === pageId);
  if (!page) throw new Error(`Wiki page ${pageId} not found`);
  const attachment = (page.attachments ?? []).find((a) => a.id === attachmentId);
  if (!attachment) throw new Error(`Attachment ${attachmentId} not found`);
  page.attachments = page.attachments.filter((a) => a.id !== attachmentId);
  await writeJson(BLOB, { items, folders });
  return attachment;
}

module.exports = {
  listPages,
  listFolders,
  createFolder,
  getPage,
  createPage,
  updatePage,
  deletePage,
  renameFolder,
  deleteFolder,
  addAttachment,
  removeAttachment,
  DEFAULT_FOLDER,
};
