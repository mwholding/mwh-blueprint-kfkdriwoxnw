# Intranet (from the blueprint)

A static intranet portal on Azure Static Web Apps with managed Azure Functions under
`api/`. **No build step**: HTML, CSS, vanilla JavaScript, and JSX compiled in the browser
where an app uses React from a CDN. Deployment is the GitHub Actions workflow in
`.github/workflows/deploy.yml`, which runs on every push to `main`.

New here? Read [README.md](README.md) for what this is, [SETUP.md](SETUP.md) for how it was
set up, [ADDING-AN-APP.md](ADDING-AN-APP.md) before adding anything.

## How to work in this repository

Push straight to `main` for ordinary changes; fetch `origin/main` first and only
fast-forward, never force-push.

**Open a pull request instead** for anything that can lock people out or expose data:
changes to `staticwebapp.config.json`, to authentication or role logic, to access checks in
`api/`, or to anything that makes the site unusable if it is wrong. A pull request builds
its own preview environment with its own URL, posted as a comment by the deploy step.

Every change ends with two things stated plainly: what the person reading has to do (sign
out and back in, set an app setting, run a script) and where the result can be seen, with a
link to the page that actually changed.

## Authentication and roles

Sign-in is Microsoft Entra ID as a custom provider. Roles are assigned on every sign-in by
`/api/GetRoles`, not by Entra.

Two levels, always consider both:

- **`intranet`** is the front door, granted purely by email domain (`ALLOWED_DOMAINS` in
  `api/_shared/config.js`). Every page and every API function checks it.
- **Access to an individual app or capability** comes from groups and permissions in
  `access.json` — a document in Blob Storage (container `app-data`), read and written by
  `api/_shared/access.js`, managed in `/apps/access-admin/`. Nothing about access lives in
  git.

The model:

- A **group** bundles permissions of the form `{ app, action, scope? }`. `action` is tiered
  for the three standard values `read < write < admin` (holding `write` satisfies a `read`
  check); any other action string is a standalone flag with no ordering. `scope` is an
  arbitrary key/value object (nothing uses one yet, see the worked example in `access.js`);
  without a scope the permission is unrestricted within the app.
- Membership is either **explicit** (the address is listed under `users[email]`) or
  **automatic by email domain** (`domains` on the group) — the latter matters because most
  people are not known by name yet.
- The SWA roles that route rules check are not a separate field: they are derived from the
  distinct `app` values of the resolved permissions.
- **`apps` is an editable registry** in the same document: `{ <id>: { label, path, gated } }`.
  The `id` is also the role name; `path` is the route pattern (empty for a permission with
  no page of its own). `gated: false` means "open to every signed-in domain user",
  `gated: true` means "only the groups with a matching permission". New apps are registered
  in `/apps/access-admin/` → **Apps** → **New**, with no code change.
- **`intranet` is a registry entry too**, the one without a folder under `apps/`. Gating it
  restricts *everything*, front and back — the switch to use when the Entra tenant contains
  far more people than should have access.
- **An id with no registry entry holds no role.** Unregistered means closed, so forgetting to
  register a new app shows up immediately as an app nobody can open, never as one everybody
  can. There is no default-open fallback to reason about.
- **The admin UI cannot lock itself out**: `selfLockoutReason` in `access.js` judges the
  *proposed* document before it is written, and `api/Access` answers 409 with the reason if
  the saving admin would remove their own front-door or `access-admin` permission.

**No deploy is needed to open or close an app.** Every `/apps/<id>/` path has a permanent
route rule requiring role `<id>`, generated from the folder names by
`misc/generate-app-routes.js` on every deploy (it reads the repository, not Blob Storage).
Who holds that role is decided at sign-in:

- `gated: false` → every user with an allowed email domain gets role `<id>`
- `gated: true` → the role comes only from a group permission

So flipping open ↔ restricted is a pure Blob Storage change, effective at the affected
person's **next sign-in**. A *new* app brings its rule along in the same deploy that creates
the folder. `--check` reports whether the committed config and the folder list disagree.

**There is no seed script and no first-run wizard.** `defaultAccess()` in
`api/_shared/access.js` is the document the site behaves as if it had until an admin saves in
`/apps/access-admin/` for the first time: the front door open to the allowed domains, *My
apps* open, the knowledge base and access management restricted. The first save writes it to
Blob Storage, and from then on the stored document is the only truth. Nothing is written
before a human presses save, so there is no bootstrap race to think about.

**`ADMIN_EMAILS` in `api/_shared/config.js` is the break-glass list.** Those addresses hold
every permission — the front door, access management, and admin on every registered app —
whatever the stored document says, which is what makes the very first sign-in work and what
gets you back in if an admin saves their own rights away. `resolvePermissionsForEmail` adds
them as ordinary permissions rather than special-casing every check, so there is still only
one permission model. Changing that list is a commit and a deploy, on purpose: it is not the
normal way to give someone access.

Checks go through named helpers from `api/_shared/access.js`: `canUseApp(email, id, action)`
for an app, `canReadWiki`/`canWriteWiki` for the knowledge base, `can` for anything else.
Add one helper per question rather than passing capability strings around: a typo in a
string silently returns false, which reads as a permissions problem and costs an hour.
**Careful with `can(email, app, action)` and no scope**: it means "in any scope", so a grant
limited to one unit already satisfies it — never use it as a shortcut for "…in this unit".
Everything is async, because it reads Blob Storage.

Rules in `staticwebapp.config.json`:

- Specific routes go **above** `"/*"`; the first matching rule wins, and the catch-all is
  always last.
- Never use `allowedRoles: ["authenticated"]`. Always a role of your own.
- `/api/GetRoles` stays `anonymous`, or every sign-in loops.
- Invalid JSON makes Azure ignore the whole file and serve the site unprotected. Validate
  after every change.

## Security rules, no exceptions

1. **No credentials in the frontend.** No keys, no connection strings, no tokens in HTML,
   JavaScript or any file under a public path. Anything needing a credential runs in `api/`
   and reads it from an app setting.

2. **Every API function checks roles itself.** Route rules protect pages, not endpoints.
   Everything runs on one origin, so any app can call any endpoint. This belongs at the top
   of every function that touches protected data:

   ```js
   const { getRoles, getUserEmail } = require("../_shared/roles");
   if (!getRoles(req).includes("intranet")) { /* 403 */ }
   // then the app-specific permission:
   if (!(await canUseApp(getUserEmail(req), "<id>", "write"))) { /* 403 */ }
   ```

   **Reading counts as much as writing.** A route rule protects the page, not the data: a
   search endpoint, an audit trail, an attachment URL or an MCP tool can each hand out the
   content of a page whose own gate is closed. Whoever builds an endpoint that serves
   content — including indirectly — checks the read permission for it.

3. **Never commit secrets.** Not in examples, comments or test files. App settings are set
   in the Azure Portal.

4. **404, not 403, when a not-found answer would leak existence** — for example an
   attachment on a page the caller may not read.

## Data

- **Small datasets that people edit**: one JSON document per dataset in Blob Storage
  through `api/_shared/jsonStore.js`, plus an audit line per write in a `.jsonl` blob so the
  history survives a restart of the function host. Every writing function logs the user and
  a timestamp.
- **Files** (PDF, Excel, images): `api/_shared/blobFiles.js`, container `intranet-files`,
  handed out as a short-lived SAS URL. Deliberately not SharePoint, so an upload can flow
  through an MCP tool call without a Graph dependency.
- **Documents, contracts, approvals**: do not rebuild these. SharePoint plus Power Automate,
  and a tile pointing there.
- **Anything needing real concurrency, reporting or a different lifecycle** does not belong
  in a JSON blob. Say so rather than building around it.
- The one concurrency tool available here is a conditional write:
  `readJsonWithEtag` + `writeJson(name, data, { ifMatch })`, which fails with 412 instead of
  silently overwriting a concurrent change.

## MCP server (`/api/Mcp`)

`/api/mcp` is a remote MCP server for Langdock chats: the knowledge base, its attachments,
search, `whoami`, and the user-app tools — the same data as the browser, through a different
door.

- **Reachable without a SWA session**: `/api/Mcp` is `anonymous` in the route rules, like
  `/api/GetRoles`, or SWA would redirect every call to a login before the function runs. All
  authentication happens inside the function.
- **A platform bug you must not "fix"**: SWA overwrites the `Authorization` header on
  managed functions with its own internal token before the code sees it
  (github.com/Azure/static-web-apps/issues/158). Langdock therefore sends its real OAuth
  token in the custom header `X-Mcp-Authorization`, which `api/Mcp/index.js` reads (with a
  fallback to `authorization` for local testing).
- **Auth is not the SWA login** but an OAuth resource server on the same identity:
  `api/_shared/verifyToken.js` reads the tenant id from the token itself (`tid`), validates
  signature and issuer against exactly that tenant, and then checks the email domain against
  `config.js` — never a field the chat asserts about itself. The authorize/token URLs use the
  multi-tenant `organizations` endpoint, so people in different tenants can sign in.
- **One App Registration, two front doors.** The registration that carries the website
  sign-in also exposes the `access_as_user` scope Langdock asks for, so it holds two redirect
  URIs (the SWA callback and Langdock's) and, by convention, one client secret per consumer
  so rotating Langdock's never logs the company out of the website. The token audience
  therefore comes from `AAD_CLIENT_ID` and needs no setting of its own; `verifyToken` accepts
  both the bare client id and its `api://<client-id>` form, because Entra writes either
  depending on the App ID URI and token version. `MCP_OAUTH_AUDIENCE` (comma-separated)
  overrides it and is only needed if the MCP integration ever gets a registration of its own.
- **Permissions come from the same `access.json`** as the browser. Unlike the browser, a
  change in `/apps/access-admin/` takes effect here **immediately**: the permission is read
  from the document, not from a role baked into a session at sign-in.
- **Protocol**: a hand-written, stateless JSON-RPC responder in `api/_shared/mcpServer.js`
  (`initialize`, `tools/list`, `tools/call`; no SSE, no session id). Not
  `@modelcontextprotocol/sdk`, whose transports expect raw Node http objects that the
  Functions v1 model (`context.req`/`context.res`) does not have. `initialize` negotiates
  against `SUPPORTED_PROTOCOL_VERSIONS` — reflecting back whatever the client asks for
  claims support for everything. Protocol fixes belong in `mcpServer.js`, so a second MCP
  server gets them too.
- Every tool carries `annotations` with `readOnlyHint`/`destructiveHint` so a client can ask
  before deleting something.
- **A tool description is the only documentation the model gets.** Write it for a reader who
  cannot see the code, and keep it in step with what the tool does.

## User apps (`/api/a/<slug>/`)

Colleagues build small static apps themselves by describing them in a Langdock chat.
Langdock creates and maintains them through the MCP tools in
`api/_shared/userAppTools.js`; the files live in Blob Storage and are served live by
`api/AppHost`. **No git push, no deploy, no involvement from the intranet maintainer.**

- **Storage layout** (`api/_shared/userAppStore.js`): index `user-apps.json` in `app-data`
  (metadata only), file bytes in `intranet-files` under `user-app/<id>/v<n>/<path>`,
  data-API values under `user-app-data/<id>/<key>`, audit trails `user-apps-audit.jsonl` and
  `user-app-data-audit.jsonl` (both readable through `api/Audit`).
- **Invariants**: the `id` is a slug derived from the name, unique and **permanent** — it is
  the URL, and renaming changes only the display name. `currentVersion` is always the
  highest version number: a rollback **copies** an old version into a new one rather than
  pointing back, which is what makes pruning (the last 20 versions are kept) safe. Every
  version physically holds all its files.
- **Custom route**: `api/AppHost/function.json` uses `"route": "a/{appId}/{*path}"`; the
  code also reads `?app=&file=` as a fallback for local testing. Owner preview of an old
  version: `/api/a/<slug>/_v/<n>/`, which is why file paths must not start with `_`.
- The 401 override appends `?post_login_redirect_uri=.referrer` so a shared deep link lands
  on the app after sign-in instead of on the home page. Do not remove it.
- **No capability gate on purpose**: every verified domain user may create apps. Everything
  after that is owner-only. **New apps are private** (`restricted` with an empty list);
  sharing is deliberate, through `set_user_app_access`, with exactly two options: `domain`
  (all signed-in users) or `restricted` plus a list of addresses. The access list lives in
  the index blob and is maintained by the owner — not in access management, so it works
  without an admin and without a re-login.
- **One person, two addresses**: `ALIAS_DOMAINS` in `config.js` makes `<name>@a` and
  `<name>@b` the same identity for ownership and sharing, because people may appear under
  one address in Langdock and another in the intranet. Audit lines keep the address actually
  used.
- **Accepted risk, decided deliberately**: the apps run without a sandbox on the same
  origin, so JavaScript written by a colleague or a model can call `/api/*` with the
  visitor's session. Mitigation is a strict CSP on every HTML response (`'self'` only, no
  external loading, no exfiltration, `frame-ancestors 'none'`), size and type limits, and an
  audit line with a verified email on every mutation. Do not "improve" this by relaxing the
  CSP; a real sandbox (a separate subdomain) is the next step if the risk is re-assessed.
- **Limits**: 8 MB per file, 24 MB per version, 40 files, 50 apps per owner; data API 300
  keys per app, shared between values and files. Values are written as a raw PUT body; file
  attachments as `PUT …&kind=file` with `{ contentType, base64 }` — base64 because managed
  functions deliver binary bodies inconsistently. Only types on the strict allowlist
  (`DATA_FILE_TYPES`) are stored, **never** `text/html` or `image/svg+xml`, which would run
  as markup on the intranet origin. Every visitor with access may read and write the app's
  data (shared app state, not per-user state).
- **Design and SDK**: `assets/app-kit.css` carries the look; `assets/app-sdk.js` exposes
  `window.APP` (`me()`, `data.*`, `ai()`, `table`, `csv`, `barChart`, `renderMarkdown`,
  `toast`). The tool description of `create_user_app` is the **only** place the model learns
  the platform rules — CSP, identity, the data API, the SDK, AI — so maintain it whenever
  serving, storage, AI or the SDK changes.

## AI functions

Everything goes through `api/_shared/langdock.js`, which is the only place this repository
talks to a language model. The key (`LANGDOCK_API_KEY`) is server-side, always.

- **`api/AppAI`** — same-origin proxy for the user apps. Guardrails, because it spends money
  on prompts written by colleagues and models: role plus app access, a fixed safety preamble
  that the app's own system prompt is appended to and cannot remove (stored data and user
  text are declared untrusted), an input cap of about 24k characters, output capped at 1500
  tokens, a soft daily quota per user, and an audit line per call.
- **`api/AiEdit`** — "rewrite this page" for the knowledge base. It rewrites what is there
  and returns it to the editor for a human to accept; it never writes to the store itself.
  It requires write permission, because an assistant must not be a way around the gate on
  the thing it edits.
- **No OCR.** It was removed on purpose: it needed a second Azure resource and two more app
  settings for something nobody needs in the first weeks. Adding it back is an Azure AI
  Document Intelligence resource plus one endpoint that submits and polls `prebuilt-read`,
  with the poll loop in the browser for the reason in the next point.
- **Long work never runs inside one request.** Anything that needs several model passes over
  a big document is chunked, with the loop in the browser calling the function once per
  chunk. Do not "simplify" that into a single request.
- **Markdown from a model is rendered escape-first**: the renderers in `apps/wiki/` escape
  the text completely and then wrap safe tags around already-escaped content, with a scheme
  check on link URLs. Never replace that with an unchecked `innerHTML`, and never load a
  Markdown library from a CDN: content can come from a chat.

## Design

The binding source is [BRANDING.md](BRANDING.md), implemented at runtime by
`assets/app-kit.css`, which every page and every user app links **first**. The tokens live
in `assets/brand.css` and are the only place a colour or font family is named:
`--brand-accent`, `--brand-accent-hover/-mid/-tint`, `--brand-ink`, `--brand-mute`,
`--brand-line`, `--brand-soft`, `--brand-paper`, `--font-sans/-condensed/-accent`.

Short version: one accent colour on neutral greys, white cards, flat surfaces, 1px
hairlines instead of shadows, square corners (a pill radius only on small badges), links in
the accent colour and underlined. No second hue, no gradients, no uppercase headlines (only
the small `.eyebrow`), no icon libraries — emoji or inline SVG.

## Adding an app

The checklist is in [ADDING-AN-APP.md](ADDING-AN-APP.md). In one line: folder under `apps/`
with an `index.html`, functions under `api/` that check permissions themselves, register the
app in `/apps/access-admin/`, add a tile in `apps/apps.json`. The route rule generates
itself.

## Troubleshooting

- `/.auth/me` shows who is signed in and which roles were assigned. First look at any
  access problem.
- 403 responses render `misc/session-refresh.html` ("Sign out and back in"): after a
  permissions change, existing sessions still carry the old roles. It is a **rewrite**, not
  a redirect, so the page can read the blocked URL from `location` — do not change that.
- 401 means not signed in; 403 means signed in without the role. A 403 is almost always a
  missing email domain in `config.js` or a missing or misspelled address or group assignment
  in access management.
- A white page in a sub-app is almost always a wrong base path.
- A red deploy saying "Deployment Failure Reason: Deployment Canceled" usually means two
  runs deployed at once and Azure cancelled the loser. Check the run list for a green run
  with the same commit before looking for a real fault.
- Invalid JSON in `staticwebapp.config.json` means the file is ignored entirely and the site
  is served unprotected. Validate after every change.

## What not to propose

- Central IT governance or a group-wide stack that does not exist.
- Solutions that need permanent operations, monitoring or a team to run them.
- Rebuilds of what Microsoft 365 or Power BI already do.
- A live connection where a nightly file would do.
- A vector database for a few hundred documents. Lexical selection is what is used here, on
  purpose.
