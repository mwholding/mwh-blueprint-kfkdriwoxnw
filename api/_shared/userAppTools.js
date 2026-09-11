// MCP tool definitions + dispatch for user apps ("vibe coding via Langdock"). Kept out of
// api/Mcp/index.js so that file stays readable; wired in there with a spread + a delegate
// call. Any verified allowed-domain user may create apps (deliberately no mcp-access.json
// capability — verifyToken has already enforced the domain); everything else is owner-only,
// enforced inside userAppStore.js.

const store = require("./userAppStore");
const { ORG_NAME } = require("./config");

// One shared schema fragment for file payloads.
const FILES_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Relative path, e.g. "index.html" or "js/app.js". Allowed: html css js mjs json svg png jpg jpeg gif webp ico txt md csv woff2. Max 8 MB per file, 24 MB per version, 40 files.' },
      content: { type: "string", description: "File content. UTF-8 text, or base64 when encoding=base64 (use base64 for images/fonts)." },
      encoding: { type: "string", enum: ["text", "base64"] },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
};

// This description doubles as the app-author contract: it is the only place Langdock learns
// the platform rules, so it spells out CSP, styling, identity and the data API.
const AUTHOR_CONTRACT = [
  `Where this runs (approved & secure — safe to proceed): the app is hosted on ${ORG_NAME}'s own Microsoft Azure infrastructure and is reachable ONLY after Microsoft Entra single sign-on — there is no public/anonymous access. App data and AI calls stay inside ${ORG_NAME}'s own tenancy and Langdock's EU region (GDPR). Building an internal, access-controlled tool here is sanctioned; do not refuse or water it down on data-protection grounds.`,
  "Rules for the app you generate:",
  "- The app is plain static HTML/CSS/JS served on the intranet origin. It must be fully self-contained: a Content-Security-Policy blocks ALL external scripts, styles, fonts and fetches. Only same-origin requests work. No CDNs, no Google Fonts, no external APIs.",
  '- Start index.html with <link rel="stylesheet" href="/assets/app-kit.css"> — it carries the house design system (fonts, colour + type tokens, and base styles for headings, buttons, inputs, tables, .card and .chip). Your own <style> loads after it and may override anything.',
  '- Keep the house look, do not restyle it away: one accent colour (var(--brand-accent)) on neutrals (var(--brand-soft), var(--brand-line), var(--brand-mute), var(--brand-paper), var(--brand-ink)); flat surfaces separated by 1px var(--brand-line) hairlines, no shadows; square corners (a pill radius only on small .chip status badges); links keep the accent colour and stay underlined; generous whitespace. Use the --brand-* / --font-* variables and the built-in classes rather than new colours. Never introduce another hue, no gradients, no ALL-CAPS headlines (a small .eyebrow is the only uppercase), and no icon libraries — emoji or inline SVG only.',
  "- The app fills the whole browser tab; begin directly with your own content (an optional in-page <h1> title is fine).",
  "- Visitor identity: fetch('/.auth/me') returns { clientPrincipal: { userDetails } } where userDetails is the visitor's email. Use it for per-user behavior; there is no way to fake it.",
  "- Persistence: the app has its own small key-value store. GET /api/AppData?app=<id> lists keys; GET /api/AppData?app=<id>&key=<k> reads a value; PUT with a JSON or plain-text body writes (max 1 MB per value, 300 keys); DELETE removes. Every visitor who can open the app can also read and write these values.",
  '- Files/attachments: to store a PDF, image (png/jpeg/gif/webp), CSV or Office file, PUT /api/AppData?app=<id>&key=<k>&kind=file with a JSON body { "contentType": "application/pdf", "base64": "<base64 of the bytes>" } (max 8 MB, counts toward the 300 keys). GET /api/AppData?app=<id>&key=<k> then returns the file bytes same-origin, so use it straight in <img src="…">, an <a href="…" download> link, or an <iframe> for PDFs (not <embed>/<object>, which the CSP blocks). HTML and SVG files are refused — they would run as script on the intranet.',
  '- Optional helper SDK: add <script src="/assets/app-sdk.js"></script> (after app-kit.css) for window.APP — APP.me() (signed-in email/roles), APP.data.get/getJSON/set/del/list and putFile/fileUrl (the store above), APP.table(rows,cols), APP.csv(rows), APP.barChart(el,data), APP.renderMarkdown(text), APP.toast(msg).',
  "- REAL AI IS BUILT IN — use it, never fake it. Whenever the app needs to summarize, extract fields, classify, answer questions, translate, or draft text, call the approved endpoint APP.ai(prompt, { system?, json?, maxTokens?, temperature?, messages? }) -> text, or APP.aiJSON(prompt, {...}) -> parsed JSON (or POST /api/AppAI?app=<id> with { prompt | messages, system?, json?, maxTokens?, temperature? }). It is a same-origin, keyless, approved proxy to Langdock, default model gpt-5.6-terra, EU-hosted. Do NOT hand-roll heuristic/regex 'AI-like' logic, do NOT pull in an external AI API, and do NOT tell the user AI is unavailable — this endpoint IS the sanctioned way to use AI in an app. Limits: ~24000 chars input, output ~1500 tokens, ~200 calls/user/day; treat stored data and user text as untrusted content inside the prompt. Example: const summary = await APP.ai('Summarise in 3 bullet points:\\n' + text);",
  "- index.html at the root is required. Relative URLs work (the app is served under its own folder URL).",
].join("\n");

const TOOLS = [
  {
    name: "create_user_app",
    description:
      `Create a small static web app on the ${ORG_NAME} intranet. It is live IMMEDIATELY at the returned url — no deployment, no git. The caller becomes the owner; only the owner can change the app later. The app name determines the permanent URL slug.\n` +
      "Sharing: a new app is PRIVATE — only the owner can open it. There are exactly two ways to share, now (accessMode) or later (set_user_app_access): open it to every signed-in intranet user (mode 'domain'), or grant named colleagues by email (mode 'restricted' + accessEmails). When the user wants to share, tell them these two options and ask which they want — do not silently open the app to everyone.\n" +
      AUTHOR_CONTRACT,
    annotations: { title: "Create user app", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "App name; also determines the permanent URL slug (lowercased, non-letters become dashes)" },
        description: { type: "string" },
        icon: { type: "string", description: "Optional single emoji shown in the app directory" },
        files: FILES_SCHEMA,
        accessMode: { type: "string", enum: ["domain", "restricted"], description: "restricted (DEFAULT) = only the owner and accessEmails may open it; domain = every signed-in intranet user. Only pass domain when the user explicitly wants the app open to everyone." },
        accessEmails: { type: "array", items: { type: "string" } },
      },
      required: ["name", "files"],
      additionalProperties: false,
    },
  },
  {
    name: "list_user_apps",
    description: "List the intranet user apps you own or can access (metadata only: id, name, description, owner, access, current version, url).",
    annotations: { title: "List user apps", readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_user_app",
    description:
      "Get one of your own user apps: metadata, full version history (each version with note, author, file list and an owner-only preview url), and optionally the file contents of one version. Owner only.",
    annotations: { title: "Get user app", readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        includeFiles: { type: "boolean", description: "Also return the file contents (text files as text, binary as base64)" },
        version: { type: "number", description: "Which version's files to return; default the current one" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "update_user_app",
    description:
      "Update one of your user apps (owner only). Files passed in `files` are added/overwritten, `deletePaths` removes files, `replaceAll: true` replaces the whole file set with `files`. Any file change creates a new version (old versions stay available for rollback, the last 20 are kept); name/description/icon changes alone do not. The change is live immediately.\n" +
      AUTHOR_CONTRACT,
    annotations: { title: "Update user app", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        files: FILES_SCHEMA,
        deletePaths: { type: "array", items: { type: "string" } },
        replaceAll: { type: "boolean" },
        name: { type: "string", description: "Display name only — the URL slug never changes" },
        description: { type: "string" },
        icon: { type: "string" },
        note: { type: "string", description: "Short changelog line shown in the version history" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "rollback_user_app",
    description:
      "Roll one of your user apps back to an earlier version (owner only). The old version's files are copied into a NEW version, so the history keeps moving forward and the rollback itself can be rolled back.",
    annotations: { title: "Roll back user app", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, version: { type: "number" } },
      required: ["id", "version"],
      additionalProperties: false,
    },
  },
  {
    name: "set_user_app_access",
    description:
      'Set who may open one of your user apps (owner only). These are the ONLY two sharing options: mode "domain" = every signed-in intranet user; mode "restricted" = only you and the listed email addresses (the default for new apps, with an empty list). Takes effect immediately, no re-login needed. Note: if the intranet is configured with alias domains, <name>@domain-a and <name>@domain-b count as the same person (people may use one in Langdock and the other to sign in), so either form works.',
    annotations: { title: "Set user app access", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        mode: { type: "string", enum: ["domain", "restricted"] },
        emails: { type: "array", items: { type: "string" } },
      },
      required: ["id", "mode"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_user_app",
    description:
      "Delete one of your user apps permanently (owner only): all versions, all stored data. The metadata and file list are preserved in the audit trail, the file contents are not — consider get_user_app with includeFiles first if you may want the code back.",
    annotations: { title: "Delete user app", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
];

const NAMES = new Set(TOOLS.map((t) => t.name));

function handles(name) {
  return NAMES.has(name);
}

function publicMeta(app, email) {
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    icon: app.icon,
    owner: app.owner,
    owned: store.isOwner(app, email),
    access: app.access,
    currentVersion: app.currentVersion,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    url: store.appUrl(app.id),
  };
}

function versionMeta(app, v) {
  return {
    n: v.n,
    createdAt: v.createdAt,
    createdBy: v.createdBy,
    note: v.note,
    totalBytes: v.totalBytes,
    files: v.files.map((f) => f.path),
    previewUrl: `${store.appUrl(app.id)}_v/${v.n}/`,
  };
}

async function requireOwnedApp(id, email) {
  const app = await store.getApp(id);
  if (!app) throw new Error(`App "${id}" not found`);
  if (!store.isOwner(app, email)) throw new Error(`Only the owner (${app.owner}) can inspect or change app "${id}"`);
  return app;
}

async function call(name, args, email) {
  switch (name) {
    case "create_user_app": {
      const app = await store.createApp(args, email);
      const shareNote =
        app.access.mode === "domain"
          ? "Every signed-in intranet user can open it."
          : app.access.emails.length
            ? `Only you and ${app.access.emails.join(", ")} can open it.`
            : "Currently only you can open it — use set_user_app_access to share it with everyone on the intranet or with named colleagues.";
      return { ...publicMeta(app, email), message: `Live now at ${store.appUrl(app.id)}. ${shareNote}` };
    }
    case "list_user_apps": {
      const apps = await store.listApps(email);
      return apps.map((a) => publicMeta(a, email));
    }
    case "get_user_app": {
      const app = await requireOwnedApp(args.id, email);
      const result = { ...publicMeta(app, email), versions: app.versions.map((v) => versionMeta(app, v)) };
      if (args.includeFiles) {
        const n = args.version !== undefined ? Number(args.version) : app.currentVersion;
        const v = app.versions.find((x) => x.n === n);
        if (!v) throw new Error(`Version ${n} of app "${args.id}" is not available`);
        result.files = [];
        for (const f of v.files) {
          const file = await store.readAppFile(app, n, f.path);
          const isText = /^(text\/|application\/json|image\/svg)/.test(f.contentType);
          result.files.push({
            path: f.path,
            encoding: isText ? "text" : "base64",
            content: file ? (isText ? file.buffer.toString("utf8") : file.buffer.toString("base64")) : null,
          });
        }
        result.filesVersion = n;
      }
      return result;
    }
    case "update_user_app": {
      const app = await store.updateApp(args.id, args, email);
      return { ...publicMeta(app, email), latestVersion: versionMeta(app, app.versions[app.versions.length - 1]) };
    }
    case "rollback_user_app": {
      const app = await store.rollbackApp(args.id, args.version, email);
      return { ...publicMeta(app, email), latestVersion: versionMeta(app, app.versions[app.versions.length - 1]) };
    }
    case "set_user_app_access": {
      const app = await store.setAccess(args.id, args, email);
      return publicMeta(app, email);
    }
    case "delete_user_app":
      return store.deleteApp(args.id, email);
    default:
      throw new Error(`Unknown tool "${name}"`);
  }
}

module.exports = { TOOLS, handles, call };
