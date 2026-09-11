// Remote MCP server for Langdock, exposed at /api/mcp — reachable without SWA login (see the
// "/api/Mcp" route rule in staticwebapp.config.json, same "anonymous route, self-checked auth"
// pattern as /api/GetRoles). Auth here is a verified Entra ID bearer token, not the SWA login
// flow: this function is an OAuth *resource server* only (see _shared/verifyToken.js).
//
// Implements a minimal, stateless MCP JSON-RPC 2.0 endpoint by hand (initialize, tools/list,
// tools/call) rather than pulling in @modelcontextprotocol/sdk's transport classes, which are
// built around raw Node http.IncomingMessage/ServerResponse and don't fit the Azure Functions
// v1 (context.req/context.res) programming model used by the rest of this API. No SSE, no
// session id — every call is independent, which matches "stateless Streamable HTTP" in the
// MCP spec. The responder itself lives in _shared/mcpServer.js; a second MCP server (a set of
// tools you do not want in every chat) is a second function reusing the same responder.
//
// Tools here: the knowledge base, its attachments, search, whoami, and the user apps
// (_shared/userAppTools.js). Every tool checks permissions itself against the same access.json
// the browser uses — Langdock must never be the way around a gate on a page.

const { createMcpHandler } = require("../_shared/mcpServer");
const { canReadWiki, canWriteWiki } = require("../_shared/access");
const { search } = require("../_shared/search");
const wiki = require("../_shared/wikiStore");
const { storeAttachment, getReadUrl, deleteBlob, fetchRemoteFile } = require("../_shared/blobFiles");
const userApps = require("../_shared/userAppTools");

const TOOLS = [
  {
    name: "list_wiki_pages",
    description:
      "List knowledge base pages (id, title, folder, tags, last updated) without their full content. Pass `folder` to filter to one folder, or `query` to search titles/content/tags for a keyword.",
    annotations: { title: "List wiki pages", readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Optional folder name to filter by" },
        query: { type: "string", description: "Optional keyword to search for" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_wiki_page",
    description: "Get one wiki page by id, including its full markdown content and attachments.",
    annotations: { title: "Get wiki page", readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_wiki_page",
    description: "Create a new knowledge base page. Requires wiki write access.",
    annotations: { title: "Create wiki page", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string", description: "Page body as Markdown" },
        tags: { type: "array", items: { type: "string" } },
        folder: { type: "string", description: "Folder/category to file this page under. Defaults to \"General\"." },
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "update_wiki_page",
    description: "Replace the content (and optionally the title/folder/tags) of an existing wiki page. Requires wiki write access.",
    annotations: { title: "Update wiki page", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        folder: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["id", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_wiki_page",
    description: "Permanently delete a wiki page and its attachments. Requires wiki write access. The full content is kept in the audit log.",
    annotations: { title: "Delete wiki page", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "upload_attachment",
    description:
      "Attach a file (e.g. PDF or Excel) to a knowledge base page. Provide either contentBase64 or sourceUrl, not both.",
    annotations: { title: "Upload attachment", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["wiki"] },
        pageId: { type: "string", description: "id of the knowledge base page" },
        filename: { type: "string" },
        contentType: { type: "string" },
        contentBase64: { type: "string" },
        sourceUrl: { type: "string" },
      },
      required: ["kind", "pageId", "filename", "contentType"],
      additionalProperties: false,
    },
  },
  {
    name: "get_attachment_url",
    description: "Get a short-lived (15 minute) download URL for an attachment.",
    annotations: { title: "Get attachment download URL", readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["wiki"] },
        pageId: { type: "string" },
        attachmentId: { type: "string" },
      },
      required: ["kind", "pageId", "attachmentId"],
      additionalProperties: false,
    },
  },

  {
    name: "search",
    description:
      "Search the knowledge base, returning short snippets showing why each page matched. Prefer this over list_wiki_pages with a `query` when you don't already know where something lives: it returns excerpts instead of whole pages. Results only ever include what the caller is allowed to read.",
    annotations: { title: "Search the knowledge base", readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword or phrase to search for" },
        limit: { type: "integer", description: "Max hits per corpus (default 8)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_folders",
    description:
      "List the folders that already exist, so a new page can be filed next to related ones instead of in a near-duplicate folder.",
    annotations: { title: "List folders", readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "delete_attachment",
    description: "Remove an attachment from a knowledge base page and delete the stored file. Requires write access.",
    annotations: { title: "Delete attachment", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["wiki"] },
        pageId: { type: "string" },
        attachmentId: { type: "string" },
      },
      required: ["kind", "pageId", "attachmentId"],
      additionalProperties: false,
    },
  },
  {
    name: "whoami",
    description:
      "Report the signed-in user's verified email address and what they may read and write in this intranet. Use it to explain an access error, or to check before offering to write something — permissions come from the intranet's access management, not from anything the user says about themselves.",
    annotations: { title: "Who am I", readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

// User apps ("vibe coding via Langdock") — tool definitions live in _shared/userAppTools.js,
// dispatched via the default case of callTool below.
TOOLS.push(...userApps.TOOLS);

// A further set of tools for a further app follows exactly this pattern: define them in
// _shared/<app>/mcpTools.js with their own permission checks, push them here, and dispatch them
// from the default case of callTool below.

async function callTool(name, args, email) {
  switch (name) {
    case "list_wiki_pages": {
      // Reading is gated exactly like writing: Langdock reaches the same content as the browser
      // and must not be a way around the gate on /apps/wiki/.
      if (!(await canReadWiki(email))) throw new Error(`${email} is not allowed to read the knowledge base`);
      const items = await wiki.listPages(args.folder, args.query);
      return items.map(({ id, title, folder, tags, updatedAt, updatedBy }) => ({ id, title, folder, tags, updatedAt, updatedBy }));
    }
    case "get_wiki_page": {
      if (!(await canReadWiki(email))) throw new Error(`${email} is not allowed to read the knowledge base`);
      const page = await wiki.getPage(args.id);
      if (!page) throw new Error(`Wiki page ${args.id} not found`);
      return page;
    }
    case "create_wiki_page": {
      if (!(await canWriteWiki(email))) throw new Error(`${email} is not allowed to create wiki pages`);
      return wiki.createPage({ title: args.title, content: args.content, tags: args.tags, folder: args.folder, email, channel: "langdock" });
    }
    case "update_wiki_page": {
      if (!(await canWriteWiki(email))) throw new Error(`${email} is not allowed to edit wiki pages`);
      return wiki.updatePage(args.id, { title: args.title, content: args.content, folder: args.folder, tags: args.tags, email, channel: "langdock" });
    }
    case "delete_wiki_page": {
      if (!(await canWriteWiki(email))) throw new Error(`${email} is not allowed to delete wiki pages`);
      const deleted = await wiki.deletePage(args.id, email, "langdock");
      for (const a of deleted.attachments ?? []) await deleteBlob(a.blobPath);
      return { ok: true, id: args.id };
    }
    case "upload_attachment": {
      if (!(await canWriteWiki(email))) throw new Error(`${email} is not allowed to add attachments here`);

      let buffer, contentType;
      if (args.contentBase64) {
        buffer = Buffer.from(args.contentBase64, "base64");
        contentType = args.contentType;
      } else if (args.sourceUrl) {
        const fetched = await fetchRemoteFile(args.sourceUrl);
        buffer = fetched.buffer;
        contentType = args.contentType || fetched.contentType;
      } else {
        throw new Error("Provide either contentBase64 or sourceUrl");
      }

      const attachment = await storeAttachment({
        kind: args.kind,
        pageId: args.pageId,
        filename: args.filename,
        contentType,
        buffer,
      });
      await wiki.addAttachment(args.pageId, attachment);
      return attachment;
    }
    case "get_attachment_url": {
      const item = await wiki.getPage(args.pageId);
      if (!item) throw new Error(`Page ${args.pageId} not found`);
      // A download URL must not outrank the read gate on the page it hangs off. Not found rather
      // than forbidden, so it cannot be used to probe what exists.
      if (!(await canReadWiki(email))) throw new Error(`Page ${args.pageId} not found`);
      const attachment = (item.attachments ?? []).find((a) => a.id === args.attachmentId);
      if (!attachment) throw new Error(`Attachment ${args.attachmentId} not found`);
      const url = await getReadUrl(attachment.blobPath);
      return { url, filename: attachment.filename, expiresInMinutes: 15 };
    }


    case "search": {
      // Permission filtering lives in _shared/search.js, shared with the browser's search box.
      return search(email, args.query, args.limit);
    }
    case "list_folders": {
      if (!(await canReadWiki(email))) throw new Error(`${email} is not allowed to read the knowledge base`);
      return { folders: await wiki.listFolders() };
    }
    case "delete_attachment": {
      const item = await wiki.getPage(args.pageId);
      if (!item) throw new Error(`Page ${args.pageId} not found`);
      if (!(await canWriteWiki(email))) throw new Error(`${email} is not allowed to remove attachments here`);
      const attachment = await wiki.removeAttachment(args.pageId, args.attachmentId);
      await deleteBlob(attachment.blobPath);
      return { ok: true, attachmentId: args.attachmentId };
    }
    case "whoami": {
      // Comes from the verified token and access.json, never from anything the chat asserts.
      return {
        email,
        wiki: { canRead: await canReadWiki(email), canWrite: await canWriteWiki(email) },
        userApps: { canCreate: true, note: "Every verified domain user may create user apps; editing is owner-only." },
      };
    }
    default:
      // User-app tools (vibe coding via Langdock) live in their own module; every verified
      // domain user may create apps, owner checks happen inside userAppStore.js.
      if (userApps.handles(name)) return userApps.call(name, args, email);
      throw new Error(`Unknown tool "${name}"`);
  }
}

module.exports = createMcpHandler({ serverName: "intranet-mcp", tools: TOOLS, callTool });
