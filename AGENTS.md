# Intranet — guide for coding agents and developers

Shared guidance for Claude, Codex and any other coding agent (`CLAUDE.md` points here), and
the shortest description of how this codebase hangs together for people too.

**What this is:** a portal. People sign in with Microsoft Entra ID and the home page shows
every app they may open, as tiles: **intranet apps** (folders in this repository) and **user
apps** (built by colleagues in a Langdock chat, stored in Blob Storage). Everything else
serves those two: access management, the Langdock connection, AI for user apps.

**How it runs:** Azure Static Web Apps with managed Azure Functions under `api/`. **No build
step**: HTML, CSS and vanilla JavaScript; Access management compiles its JSX in the browser.
`.github/workflows/deploy.yml` tests and deploys every push: `main` to production, any other
branch to the single `preview` environment. See [README.md](README.md) for the product and
[SETUP.md](SETUP.md) for the setup.

## Where things are

| Path | What |
|---|---|
| `site.config.json` | the few things an organisation configures: name, tagline, admins, Langdock, accent and font |
| `index.html` | the home page: intranet apps and user apps as one set of tiles |
| `apps/<id>/` | one folder per intranet app; `<id>` is its route, role and registry key. `apps/hello-intranet/` + `api/HelloIntranet/` is the example to copy |
| `api/<Function>/` | one Azure Function per folder (`function.json` + `index.js`) |
| `api/_shared/*.js` | platform code: `config`, `access`, `roles`, `jsonStore`, `jsonDoc`, `blobFiles`, `langdock`, `verifyToken` |
| `api/_shared/<app>/` | code for one part: `user-apps/`, `mcp/` |
| `api/_tests/` | `cd api && npm test`, no Azure needed; the deploy runs them first. They use `_tests/fixtures/site.config.json`, never the organisation's own |
| `assets/` | `app-kit.css` (the look), `brand.css` (**generated**), `app-sdk.js` (user-app helpers), logo, favicon |
| `misc/` | `access-generate-routes.js`, `site-generate-brand.js`, `access-error.html`, `not-found.html` |
| `staticwebapp.config.json` | sign-in, route rules, headers |

## How to work in this repository

Push straight to `main` for ordinary changes; fetch `origin/main` first, integrate, and only
fast-forward. Never force-push.

**Open a pull request instead** for anything that can lock people out or expose data:
`staticwebapp.config.json`, sign-in or role logic, access checks in `api/`, or anything that
makes the site unusable if it is wrong. Branch pushes deploy to `preview` for trying it.

Every change ends by stating what the reader has to do (sign out and back in, set an app
setting, re-sync Langdock) and where the result can be seen.

## Configuration

`site.config.json` is the one file an organisation edits (each key is explained in
README.md → Configuration). It reaches three places:

- **Functions**: `api/_shared/config.js` reads it. The deploy copies it to `api/` because
  Azure deploys only that folder; locally and in tests the root file is read. No other file
  in `api/` holds an organisation-specific value.
- **Pages**: never the file itself (a route rule answers 404 for it). `api/Site` hands out
  the public part: name, tagline, Langdock link and integration name.
- **Brand**: `misc/site-generate-brand.js` writes `assets/brand.css` from `brand.accent` and
  `brand.font` on every deploy; it derives the accent's shades, the greys are fixed. Never edit
  `brand.css` by hand.

## Access

**Who may sign in at all is decided by the Entra app registration** (single tenant, or
"Assignment required"), not by the code: whoever Entra lets through is signed in. Everything
else comes from **`access.json`**, one document in Blob Storage, read and written by
`api/_shared/access.js` and edited in `/apps/access-admin/`. Nothing about access is in git.

`access.json` holds `apps` (the registry, one entry per app or link:
`{ label, description, path, url, gated, showOnHome, order, status }`; the entry is also the
home page tile), `groups` (`{ label, domains, permissions: [{ app, action, scope? }] }`,
membership explicit via `users` or automatic by email domain) and `users`
(`{ email: [group, …] }`).

The rules, in full:

- **Every app has one switch, `gated`.** Open: everyone who may sign in gets in, at every
  level. Restricted: only groups holding a permission for it.
- **The home page (`intranet`) follows the same switch.** Whoever may use it is a
  **member**: home page, tiles, the Langdock connection. **App-only guests** may sign in but
  are not members: they open the apps given to them by link, never the home page.
- **An id with no registry entry grants nothing.** A forgotten registration shows up as an
  app nobody can open, never one everybody can.
- `action` is tiered `read < write < admin`; any other string is a flag that must match
  exactly. `scope` is a free-form object; none is used yet (example in `access.js`).
- **`adminEmails` are break-glass**: they hold every permission whatever is stored.
  Changing them is a commit and a deploy, on purpose.
- **Before the first save** the site runs on `defaultAccess()`: home page open, access
  management restricted, Hello Intranet open. There is no seed script.
- **Access management cannot lock its admin out**: `selfLockoutReason` judges the proposed
  document; `api/Access` answers 409 with the reason.

How they are applied:

- **Pages**: `/api/GetRoles` hands out SWA roles at sign-in (`getRolesForEmail`): `signed-in`
  for everyone allowed, `intranet` for members, one role per app the person may open. Each
  `/apps/<id>/*` path has a rule requiring role `<id>`, generated from the folders on every
  deploy. A change reaches pages at the next sign-in; no deploy.
- **APIs never trust those roles.** Every function asks `access.js` live, first
  `canUseAnyApp(email, [its app ids])`, then its record-level checks. A change reaches the
  APIs and the chat within 30 seconds (per-instance cache; app setting `ACCESS_CACHE_MS`,
  0 turns it off).

Helpers: `canUseAnyApp` / `canUseApp` follow the switch. `can(email, app, action, scope?)`
asks for a group grant and ignores the switch — for what an open app must not give everyone
(editing, `admin`); **without a scope it means "in any scope"**, never use it as a shortcut
for "…in this unit". Add one named helper per question instead of passing strings around.
`isMember(email)` for the home page and the chat. `listAppModes(email)` feeds the tiles.

## Route rules (`staticwebapp.config.json`)

- Handwritten first: `/api/GetRoles` and `/api/Mcp` **anonymous** (GetRoles, or every
  sign-in loops; Mcp, because it checks tokens itself), `/misc/*.js` and `/site.config.json`
  404, then `/api/*` and `/assets/*` for `signed-in`. Then the generated `/apps/<id>/*`
  rules, and `"/*"` for `intranet` always last. The first matching rule wins.
- `misc/access-generate-routes.js` keeps handwritten rules and drops generated ones whose
  folder is gone; `--check` reports drift.
- Never use the built-in `authenticated` role.
- Invalid JSON makes Azure ignore the whole file and serve the site **unprotected**.
  Validate after every change.
- The 403 override is a **rewrite** to `misc/access-error.html`, so the page can send the
  person through sign-out and sign-in back to the URL they wanted. Keep it a rewrite. 404
  rewrites to `misc/not-found.html`. There is no navigation fallback: pages route by hash.

## Security rules, no exceptions

1. **No credentials in the frontend or the repository** — not in HTML, JavaScript,
   examples, tests or comments. Server code reads Azure app settings.
2. **Every API function checks permissions itself.** Route rules protect pages, not
   endpoints: everything runs on one origin. Reading counts as much as writing.
3. **404, not 403, where "forbidden" would reveal that something exists** (a private user app).
4. **Escape untrusted content** before it reaches `innerHTML`, and scheme-check links (the
   home page accepts only `/…` and `http(s)://` tile links).
5. **Do not loosen** the user-app CSP, the upload allowlists or the anonymous routes.

## Data

- **Small datasets people edit**: one JSON document in Blob Storage (container `app-data`),
  written through **`api/_shared/jsonDoc.js`**: `mutateJson` for a read-change-write (retries
  by itself when another request wrote first), `loadTracked`/`saveTracked` when a request
  holds the document longer (a lost race becomes 409 "reload and try again"). **Never write
  a shared blob blindly.** One audit line per write (`appendAuditLine`: user, time, what).
- **Files**: `api/_shared/blobFiles.js`, container `intranet-files`; `getReadUrl` hands out
  a short-lived link after the read check.
- **Documents, approvals, dashboards**: do not rebuild them. SharePoint, Power Automate, Power
  BI — and a link tile in the registry.
- **Real concurrency, reporting or another lifecycle** does not belong in a JSON blob. Say so.
- **Long work never runs inside one request**: bounded steps, the loop in the browser.

## User apps (`/api/a/<slug>/`)

Colleagues build small static apps by describing them in a Langdock chat. The MCP tools in
`api/_shared/user-apps/tools.js` create and change them, the files live in Blob Storage, and
`api/AppHost` serves them live. **No git, no deploy, no maintainer involved.** The home page
lists them through `api/UserApps` (members; owners delete there too).

- **The example** Hello Langdock (`user-apps/examples/hello-langdock/`) is created by
  `withExample()` the first time the index is read on a fresh install, owned by the first
  `adminEmails` address and shared with everyone. Once the index exists it never comes back.
- **Storage** (`user-apps/store.js`): index `user-apps.json` (saved with `saveTracked`), file
  bytes under `user-app/<id>/v<n>/<path>`, data under `user-app-data/<id>/<key>`, audit in
  `user-apps-audit.jsonl` and `user-app-data-audit.jsonl`.
- **Invariants**: the `id` is a slug of the name, unique and **permanent** (it is the URL).
  `currentVersion` is always the highest number; a rollback **copies** an old version into a
  new one, which is what makes pruning (the last 20 are kept) safe. Every version holds all
  its files. File paths may not start with `_` (`/api/a/<slug>/_v/<n>/` is the owner preview).
- `api/AppHost/function.json` uses the route `a/{appId}/{*path}`; `?app=&file=` is the
  local-testing fallback. The 401 override appends `?post_login_redirect_uri=.referrer` so a
  shared link lands on the app after sign-in. Keep both.
- **Access, separate from access management**: everyone who may sign in holds `signed-in`,
  guests included; each app's own list decides (`user-apps/access.js`). New apps are
  **private**; the owner shares with `domain` (everyone who may sign in) or `restricted` plus
  addresses. An app the caller may not open answers 404. Creating needs no permission;
  everything after is owner-only. Addresses compare case-insensitively.
- **Accepted risk, decided deliberately**: user apps run unsandboxed on the same origin, so
  their JavaScript can call `/api/*` as the visitor. The mitigation is a strict CSP on every
  HTML response (`'self'` only, `frame-ancestors 'none'`), size and type limits, and an audit
  line with a verified email on every change. Do not relax the CSP; a separate subdomain is
  the next step if the risk is re-assessed.
- **Limits**: 8 MB per file, 24 MB per version, 40 files, 50 apps per owner, 300 data keys
  per app. Data files only from `DATA_FILE_TYPES` — **never** `text/html` or `image/svg+xml`.
- **What the model learns**: the `create_user_app`/`update_user_app` descriptions carry the
  platform rules (CSP, identity, data API, SDK, AI) and stay short, because every
  `tools/list` sends them; the design rules are in `DESIGN_GUIDE`, returned by
  `get_user_app_guide`. Keep both in step with `assets/app-kit.css`, `assets/app-sdk.js`
  and the serving code; the tests check the descriptions stay short.

## The Langdock connection (`/api/Mcp`)

- **Tools**: `whoami` (in `api/Mcp/index.js`) and the user-app tools. An intranet app that
  should be usable from a chat gets `api/_shared/<id>/tools.js` (`TOOLS`, `handles`, `call`)
  wired into `api/Mcp/index.js`; each tool checks permissions itself. Langdock allows about
  50 tools per connection. **A tool description is the only documentation the model gets**,
  and after any change to the tools the integration must be **re-synced in Langdock**.
- **Reachable without a SWA session** (`/api/Mcp` is anonymous); all auth is in the function.
- **A platform bug you must not "fix"**: SWA overwrites the `Authorization` header on
  managed functions (github.com/Azure/static-web-apps/issues/158), so Langdock sends its
  token in `X-Mcp-Authorization`; the standard header is only a local fallback.
- **Token check** (`verifyToken.js`): tenant from the token (`tid`), signature and issuer
  against that tenant, and the audience against our registration. The OAuth URLs use
  the multi-tenant `organizations` endpoint. One App Registration serves the website and
  Langdock (one secret each); the audience is `AAD_CLIENT_ID`, overridable with
  `MCP_OAUTH_AUDIENCE`.
- **Protocol**: a hand-written, stateless JSON-RPC responder in `mcp/server.js`
  (`initialize`, `tools/list`, `tools/call`; no SSE, no session id), because the MCP SDK's
  transports need raw Node http objects the Functions v1 model lacks. Results go out once,
  as text. Every tool carries `annotations` (`readOnlyHint`, `destructiveHint`).

## AI

`api/_shared/langdock.js` is the only place that talks to a language model; the key
(`LANGDOCK_API_KEY`) is server-side, always. `api/AppAI` is the proxy for user apps: app
access, a fixed safety preamble the app's prompt cannot remove, ~24k characters in, 1500
tokens out, a daily quota of 200 calls per person, an audit line per call.
No OCR, on purpose (a second Azure resource).

## Design

`assets/app-kit.css` carries the look and is linked first by every page and user app; the
colours and fonts are the `--brand-*` / `--font-*` variables from the generated
`assets/brand.css`; shapes and shadows are the `--radius-*` / `--shadow-*` variables in
`app-kit.css`. Calm and monotone: one accent (near-black by default) on neutral greys, white
cards on a very light page, 1px hairlines, soft corners (a pill only on `.chip`), a faint
shadow only on hover or for floating things, underlined links. No second hue, no gradients,
no uppercase headlines (only `.eyebrow`), no icon libraries — emoji or inline SVG. Every page
works at phone width, with empty, loading and error states. `misc/*.html` are shown to people
who are not signed in, so they carry their own styles (`/assets/*` needs a sign-in).

## Troubleshooting

- `/.auth/me` shows who is signed in and which roles they got. Start there.
- 401: not signed in. 403: signed in without the role — a restricted home page, an
  unregistered app, or a missing group grant. A Microsoft error at sign-in: Entra refused
  the person (see SETUP.md step 5).
- After a permission change, pages need a new sign-in; APIs follow within 30 seconds.
- "Deployment Canceled": two runs deployed at once. Look for a green run with the same commit.
- Cannot sign in to the preview: its redirect URI is missing (SETUP.md step 5).
- A second workflow `azure-static-web-apps-<name>.yml` appeared: Azure generates it when a
  Static Web App is linked to GitHub as its source. It deploys the wrong folders, without the
  functions and route rules. Delete it; `deploy.yml` is the only deploy workflow, with the
  secret `AZURE_STATIC_WEB_APPS_API_TOKEN` (SETUP.md step 4).
