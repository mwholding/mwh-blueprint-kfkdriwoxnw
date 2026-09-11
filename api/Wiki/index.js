const { getRoles, getUserEmail } = require("../_shared/roles");
const { canReadWiki, canWriteWiki } = require("../_shared/access");
const wiki = require("../_shared/wikiStore");
const { deleteBlob } = require("../_shared/blobFiles");

module.exports = async function (context, req) {
  if (!getRoles(req).includes("intranet")) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }
  const email = getUserEmail(req) || "unknown";

  // Reads are gated too, not just writes: this endpoint is reachable by every signed-in staff
  // member (the "/*" catch-all), so without this check the "controlling"-only route rule on
  // /apps/wiki/ would guard the page while the API handed out the same content to anyone.
  if (!(await canReadWiki(email))) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }

  if (req.method === "GET") {
    if (req.query.id) {
      const page = await wiki.getPage(req.query.id);
      if (!page) {
        context.res = { status: 404, body: { error: "Not found" } };
        return;
      }
      context.res = { body: page };
      return;
    }
    const items = await wiki.listPages(req.query.folder, req.query.query);
    const folders = await wiki.listFolders();
    context.res = { body: { items, folders } };
    return;
  }

  if (req.method === "POST") {
    if (!(await canWriteWiki(email))) {
      context.res = { status: 403, body: { error: "Forbidden" } };
      return;
    }
    if (req.query.createFolder) {
      const { path } = req.body ?? {};
      if (!path) {
        context.res = { status: 400, body: { error: "Expected { path }" } };
        return;
      }
      try {
        const result = await wiki.createFolder(path, email);
        context.log(`WIKI CREATE-FOLDER ${email} ${path}`);
        context.res = { body: result };
      } catch (err) {
        context.res = { status: 409, body: { error: err.message } };
      }
      return;
    }
    const { title, content, tags, folder } = req.body ?? {};
    if (!title || !content) {
      context.res = { status: 400, body: { error: "Expected { title, content, tags?, folder? }" } };
      return;
    }
    const page = await wiki.createPage({ title, content, tags, folder, email });
    context.log(`WIKI CREATE ${email} pageId=${page.id}`);
    context.res = { body: page };
    return;
  }

  if (req.method === "PUT") {
    if (!(await canWriteWiki(email))) {
      context.res = { status: 403, body: { error: "Forbidden" } };
      return;
    }
    if (req.query.renameFolder) {
      const { from, to } = req.body ?? {};
      if (!from || !to) {
        context.res = { status: 400, body: { error: "Expected { from, to }" } };
        return;
      }
      try {
        const result = await wiki.renameFolder(from, to, email);
        context.log(`WIKI RENAME-FOLDER ${email} ${from} -> ${to}`);
        context.res = { body: result };
      } catch (err) {
        context.res = { status: 404, body: { error: err.message } };
      }
      return;
    }
    const { id, title, content, folder, tags } = req.body ?? {};
    if (!id || !content) {
      context.res = { status: 400, body: { error: "Expected { id, content, title?, folder?, tags? }" } };
      return;
    }
    try {
      const page = await wiki.updatePage(id, { title, content, folder, tags, email });
      context.log(`WIKI UPDATE ${email} pageId=${id}`);
      context.res = { body: page };
    } catch (err) {
      context.res = { status: 404, body: { error: err.message } };
    }
    return;
  }

  if (req.method === "DELETE") {
    if (!(await canWriteWiki(email))) {
      context.res = { status: 403, body: { error: "Forbidden" } };
      return;
    }
    if (req.query.folder) {
      try {
        await wiki.deleteFolder(req.query.folder, email);
        context.log(`WIKI DELETE-FOLDER ${email} ${req.query.folder}`);
        context.res = { body: { ok: true } };
      } catch (err) {
        context.res = { status: 409, body: { error: err.message } };
      }
      return;
    }
    const id = req.query.id;
    if (!id) {
      context.res = { status: 400, body: { error: "Expected ?id= or ?folder=" } };
      return;
    }
    try {
      const deleted = await wiki.deletePage(id, email);
      for (const a of deleted.attachments ?? []) await deleteBlob(a.blobPath);
      context.log(`WIKI DELETE ${email} pageId=${id}`);
      context.res = { body: { ok: true } };
    } catch (err) {
      context.res = { status: 404, body: { error: err.message } };
    }
    return;
  }

  context.res = { status: 405, body: { error: "Method not allowed" } };
};
