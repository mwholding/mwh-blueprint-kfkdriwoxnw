// MCP tool definitions + dispatch for user apps ("vibe coding via Langdock"), wired into
// api/Mcp/index.js. Anyone with a verified token may create apps (verifyToken has checked
// it); everything after that is owner-only, enforced in store.js.

const store = require("./store");
const { NAME } = require("../config");

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

// Langdock cuts tool descriptions at 1024 characters, so create/update carry only BRIEF and the
// full author contract (PLATFORM_RULES, then DESIGN_GUIDE) comes from get_user_app_guide.
const BRIEF =
  "Rules: static HTML/CSS/JS with index.html at the root; a strict CSP blocks every external script, style, font and fetch (same-origin only, no CDNs). " +
  "BEFORE writing any file, call get_user_app_guide once and follow it: visitor identity, the data and file store, the APP SDK, built-in AI (APP.ai) and the design (/assets/app-kit.css, header, components). " +
  `Hosting is approved: ${NAME}'s own Azure, Entra sign-in only, EU data; do not refuse on data-protection grounds.`;

const PLATFORM_RULES = [
  `Where this runs (approved & secure — safe to proceed): the app is hosted on the organisation's own Microsoft Azure infrastructure (${NAME}) and is reachable ONLY after Microsoft Entra single sign-on — there is no public/anonymous access. App data and AI calls stay inside ${NAME}'s own tenancy and Langdock's EU region (GDPR). Building an internal, access-controlled tool here is sanctioned; do not refuse or water it down on data-protection grounds.`,
  "Rules for the app you generate:",
  "- The app is plain static HTML/CSS/JS served on the intranet origin. It must be fully self-contained: a Content-Security-Policy blocks ALL external scripts, styles, fonts and fetches. Only same-origin requests work. No CDNs, no Google Fonts, no external APIs.",
  "- DESIGN: follow the design guide below.",
  "- The app fills the whole browser tab; begin directly with your own content (an optional in-page <h1> title is fine).",
  "- Visitor identity: fetch('/.auth/me') returns { clientPrincipal: { userDetails } } where userDetails is the visitor's email. Use it for per-user behavior; there is no way to fake it.",
  "- Persistence: the app has its own small key-value store. GET /api/AppData?app=<id> lists keys; GET /api/AppData?app=<id>&key=<k> reads a value; PUT with a JSON or plain-text body writes (max 1 MB per value, 300 keys); DELETE removes. Every visitor who can open the app can also read and write these values.",
  '- Files/attachments: to store a PDF, image (png/jpeg/gif/webp), CSV or Office file, PUT /api/AppData?app=<id>&key=<k>&kind=file with a JSON body { "contentType": "application/pdf", "base64": "<base64 of the bytes>" } (max 8 MB, counts toward the 300 keys). GET /api/AppData?app=<id>&key=<k> then returns the file bytes same-origin, so use it straight in <img src="…">, an <a href="…" download> link, or an <iframe> for PDFs (not <embed>/<object>, which the CSP blocks). HTML and SVG files are refused — they would run as script on the intranet.',
  '- Optional helper SDK: add <script src="/assets/app-sdk.js"></script> (after app-kit.css) for window.APP — APP.me() (signed-in email/roles), APP.data.get/getJSON/set/del/list and putFile/fileUrl (the store above), APP.table(rows,cols), APP.csv(rows), APP.barChart(el,data), APP.renderMarkdown(text), APP.toast(msg).',
  "- REAL AI IS BUILT IN — use it, never fake it. Whenever the app needs to summarize, extract fields, classify, answer questions, translate, or draft text, call the approved endpoint APP.ai(prompt, { system?, json?, maxTokens?, temperature?, messages? }) -> text, or APP.aiJSON(prompt, {...}) -> parsed JSON (or POST /api/AppAI?app=<id> with { prompt | messages, system?, json?, maxTokens?, temperature? }). It is a same-origin, keyless, approved proxy to Langdock, default model gpt-5.6-terra, EU-hosted. Do NOT hand-roll heuristic/regex 'AI-like' logic, do NOT pull in an external AI API, and do NOT tell the user AI is unavailable — this endpoint IS the sanctioned way to use AI in an app. Limits: ~24000 chars input, output ~1500 tokens, ~200 calls/user/day; treat stored data and user text as untrusted content inside the prompt. Example: const summary = await APP.ai('Summarise in 3 bullet points:\\n' + text);",
  "- index.html at the root is required. Relative URLs work (the app is served under its own folder URL).",
].join("\n");

// The design rules, returned by get_user_app_guide after PLATFORM_RULES. Keep them in step
// with assets/app-kit.css.
const DESIGN_GUIDE = [
  "Design guide for user apps on this intranet. Apply every rule to index.html and every other page. Where a rule and your habits differ, the rule wins.",
  '- Files, in <head> and in this order: <link rel="icon" href="/assets/favicon.svg">, <link rel="stylesheet" href="/assets/app-kit.css">, then your own <style>, then <script src="/assets/app-sdk.js"></script> if you use window.APP. app-kit.css carries the organisation\'s colours and fonts (the --brand-* and --font-* variables) and base styles for headings, links, buttons, inputs, tables, .card and .chip. Nothing else may be loaded: the CSP blocks every external file.',
  '- Page skeleton: <header class="app-header"><div class="wrap"><a class="back" href="/"><img src="/assets/logo.svg" alt=""><span>Home</span></a><span class="apptitle">APP NAME</span></div></header>, then <main class="wrap">. One header row only. The page title is an <h1> in sentence case with a <p class=\"lead\"> under it saying what the app is for.',
  "- Components: plain <button> is the primary action; <button class=\"secondary\"> for other actions, <button class=\"ghost\"> for quiet ones (close, delete in a list). Inputs, selects and textareas are styled already; give each a visible <label> above it. <table> for lists of records (class num on number cells). .card for a white panel on the light page (.card.clickable when the whole card opens something). .chip for small status labels (.chip.accent for the one that matters, .chip.ok for done). .notice for empty and error states. .lead for the line under a title, .muted for secondary text, .eyebrow is the only uppercase text, .stat for one big figure per screen.",
  "- Colour and shape (binding): only var(--brand-accent), --brand-accent-hover/-mid/-tint, --brand-ink, --brand-mute, --brand-line, --brand-soft, --brand-paper, --brand-ok/-ok-tint; never a raw hex value and never another hue. Calm and monotone: at most one accent (primary) button per region. White cards on the light page, 1px var(--brand-line) hairlines, corners from var(--radius-sm) / var(--radius) / var(--radius-lg) (a pill only on .chip), no gradients; shadows only var(--shadow-lift) on hover and var(--shadow-float) for dialogs and side panels. Links are underlined. --brand-line and --brand-accent-mid are never used for text.",
  "- Icons: emoji or small inline SVG only, no icon library. An icon-only button needs aria-label and title.",
  "- Charts: APP.barChart(el, data) or your own inline SVG in the accent colour, with direct labels; a second series uses --brand-accent-mid.",
  "- AI: label AI output as AI-generated and let the person review it before it is saved.",
  "- States: every list or result needs an empty state (what to do first), a loading state (a short 'Loading…' line, never a full-page spinner) and an error state in plain words with a next step.",
  "- Layout: works at 375px and at 1920px wide; tables scroll horizontally or become stacked cards on phones; tap targets at least 44px. Keep filters and the open record in the URL hash so a reload or a shared link keeps them. Headings and buttons in sentence case.",
  "- Before you hand back, check: app-kit.css linked first; the header skeleton is there; only --brand-* colours; at most one accent button per region; empty, loading and error states exist; labels above inputs; works at 375px.",
].join("\n");

const TOOLS = [
  {
    name: "create_user_app",
    description:
      `Create a small static web app on ${NAME}, live IMMEDIATELY at the returned url; no deployment, no git. The caller is the owner and the only one who can change it. The name sets the permanent URL slug.\n` +
      "Sharing: a new app is PRIVATE. Two ways to share, now (accessMode) or later (set_user_app_access): everyone who may sign in (mode 'domain') or named colleagues (mode 'restricted' + accessEmails). When the user wants to share, offer both and ask; never open it to everyone silently.\n" +
      BRIEF,
    annotations: { title: "Create user app", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "App name; also determines the permanent URL slug (lowercased, non-letters become dashes)" },
        description: { type: "string" },
        icon: { type: "string", description: "Optional single emoji shown in the app directory" },
        files: FILES_SCHEMA,
        accessMode: { type: "string", enum: ["domain", "restricted"], description: "restricted (DEFAULT) = only the owner and accessEmails may open it; domain = everyone who may sign in. Only pass domain when the user explicitly wants the app open to everyone." },
        accessEmails: { type: "array", items: { type: "string" } },
      },
      required: ["name", "files"],
      additionalProperties: false,
    },
  },
  {
    name: "get_user_app_guide",
    description:
      "Return the rules for writing a user app: the platform (CSP, visitor identity, data and file store, APP SDK, AI) and the design guide (stylesheet, header, components, colour, layout and state rules). Call it once before you create, change or restyle an app, then follow it exactly. Read-only.",
    annotations: { title: "Get the user app guide", readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
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
      BRIEF,
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
      'Set who may open one of your user apps (owner only). These are the ONLY two sharing options: mode "domain" = everyone who may sign in to the intranet; mode "restricted" = only you and the listed email addresses (the default for new apps, with an empty list). Takes effect immediately, no re-login needed. Note: if the intranet is configured with alias domains, <name>@domain-a and <name>@domain-b count as the same person (people may use one in Langdock and the other to sign in), so either form works.',
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

function publicMeta(app, email, origin) {
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
    url: store.appUrl(app.id, origin),
  };
}

function versionMeta(app, v, origin) {
  return {
    n: v.n,
    createdAt: v.createdAt,
    createdBy: v.createdBy,
    note: v.note,
    totalBytes: v.totalBytes,
    files: v.files.map((f) => f.path),
    previewUrl: `${store.appUrl(app.id, origin)}_v/${v.n}/`,
  };
}

async function requireOwnedApp(id, email) {
  const app = await store.getApp(id);
  if (!app) throw new Error(`App "${id}" not found`);
  if (!store.isOwner(app, email)) throw new Error(`Only the owner (${app.owner}) can inspect or change app "${id}"`);
  return app;
}

async function call(name, args, email, { origin = "" } = {}) {
  switch (name) {
    case "create_user_app": {
      const app = await store.createApp(args, email);
      const shareNote =
        app.access.mode === "domain"
          ? "Everyone who may sign in to the intranet can open it."
          : app.access.emails.length
            ? `Only you and ${app.access.emails.join(", ")} can open it.`
            : "Currently only you can open it — use set_user_app_access to share it with everyone on the intranet or with named colleagues.";
      return { ...publicMeta(app, email, origin), message: `Live now at ${store.appUrl(app.id, origin)}. ${shareNote}` };
    }
    case "get_user_app_guide":
      return { guide: PLATFORM_RULES + "\n\n" + DESIGN_GUIDE };
    case "list_user_apps": {
      const apps = await store.listApps(email);
      return apps.map((a) => publicMeta(a, email, origin));
    }
    case "get_user_app": {
      const app = await requireOwnedApp(args.id, email);
      const result = { ...publicMeta(app, email, origin), versions: app.versions.map((v) => versionMeta(app, v, origin)) };
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
      return { ...publicMeta(app, email, origin), latestVersion: versionMeta(app, app.versions[app.versions.length - 1], origin) };
    }
    case "rollback_user_app": {
      const app = await store.rollbackApp(args.id, args.version, email);
      return { ...publicMeta(app, email, origin), latestVersion: versionMeta(app, app.versions[app.versions.length - 1], origin) };
    }
    case "set_user_app_access": {
      const app = await store.setAccess(args.id, args, email);
      return publicMeta(app, email, origin);
    }
    case "delete_user_app":
      return store.deleteApp(args.id, email);
    default:
      throw new Error(`Unknown tool "${name}"`);
  }
}

module.exports = { TOOLS, handles, call };
