// Browser-facing counterpart to the MCP `upload_attachment`/`get_attachment_url` tools — same
// blob storage (_shared/blobFiles.js), same permissions (_shared/access.js), so a file attached
// from a Langdock chat and one attached in the browser end up in the same place with the same
// rules. `kind` exists so a second attachable corpus can be added without a second endpoint.

const { getRoles, getUserEmail } = require("../_shared/roles");
const { canReadWiki, canWriteWiki } = require("../_shared/access");
const { storeAttachment, getReadUrl, deleteBlob } = require("../_shared/blobFiles");
const wiki = require("../_shared/wikiStore");

const KINDS = ["wiki"];

module.exports = async function (context, req) {
  if (!getRoles(req).includes("intranet")) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }
  const email = getUserEmail(req) || "unknown";

  if (req.method === "GET") {
    const { kind, pageId, attachmentId } = req.query;
    if (!kind || !pageId || !attachmentId) {
      context.res = { status: 400, body: { error: "Expected ?kind=&pageId=&attachmentId=" } };
      return;
    }
    if (!KINDS.includes(kind)) {
      context.res = { status: 400, body: { error: `kind must be one of ${KINDS.join(", ")}` } };
      return;
    }
    const item = await wiki.getPage(pageId);
    // Same read gate as the page itself, or a download URL becomes the way around it. 404 rather
    // than 403 so this can't be used to probe which pages exist in a wiki you may not read.
    const canRead = await canReadWiki(email);
    const attachment = canRead ? item?.attachments?.find((a) => a.id === attachmentId) : null;
    if (!attachment) {
      context.res = { status: 404, body: { error: "Not found" } };
      return;
    }
    const url = await getReadUrl(attachment.blobPath);
    context.res = { body: { url, filename: attachment.filename } };
    return;
  }

  if (req.method === "POST") {
    const { kind, pageId, filename, contentType, contentBase64 } = req.body ?? {};
    if (!kind || !pageId || !filename || !contentType || !contentBase64) {
      context.res = {
        status: 400,
        body: { error: "Expected { kind, pageId, filename, contentType, contentBase64 }" },
      };
      return;
    }
    if (!KINDS.includes(kind) || !(await canWriteWiki(email))) {
      context.res = { status: 403, body: { error: "Forbidden" } };
      return;
    }

    try {
      const buffer = Buffer.from(contentBase64, "base64");
      const attachment = await storeAttachment({ kind, pageId, filename, contentType, buffer });
      await wiki.addAttachment(pageId, attachment);
      context.log(`ATTACHMENT UPLOAD ${email} kind=${kind} pageId=${pageId} filename=${filename}`);
      context.res = { body: attachment };
    } catch (err) {
      context.res = { status: 400, body: { error: err.message } };
    }
    return;
  }

  if (req.method === "DELETE") {
    const { kind, pageId, attachmentId } = req.query;
    if (!kind || !pageId || !attachmentId) {
      context.res = { status: 400, body: { error: "Expected ?kind=&pageId=&attachmentId=" } };
      return;
    }
    if (!KINDS.includes(kind) || !(await canWriteWiki(email))) {
      context.res = { status: 403, body: { error: "Forbidden" } };
      return;
    }
    try {
      const attachment = await wiki.removeAttachment(pageId, attachmentId);
      await deleteBlob(attachment.blobPath);
      context.log(`ATTACHMENT DELETE ${email} kind=${kind} pageId=${pageId} attachmentId=${attachmentId}`);
      context.res = { body: { ok: true } };
    } catch (err) {
      context.res = { status: 404, body: { error: err.message } };
    }
    return;
  }

  context.res = { status: 405, body: { error: "Method not allowed" } };
};
