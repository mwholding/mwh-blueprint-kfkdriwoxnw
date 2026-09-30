# Intranet blueprint

**This repository is a GitHub template.** Press **Use this template** to give your
organisation its own copy ([SETUP.md](SETUP.md), step 1), then make that copy yours. Do not
develop in the template itself.

## What it is

A small portal your colleagues sign in to with their Microsoft work account. The home page
shows **every app they may open, as tiles, in one place**. There are two kinds of app, and
the home page shows both side by side:

| | **User apps** | **Intranet apps** |
|---|---|---|
| Who builds it | any colleague, by describing it in a Langdock chat | a developer (or a coding assistant), in this repository |
| How long it takes | minutes | days |
| Where it lives | Blob Storage, served live at `/api/a/<name>/` | a folder `apps/<name>/`, deployed with a push to `main` |
| Who may open it | private at first; the owner shares it with everyone or with named people | decided in access management: open to everyone, or to groups |
| What it can do | a form, a list, a checklist, a calculator; its own storage and files; AI; the visitor's identity | everything a user app can, plus its own server code: other systems, credentials, scheduled data, complex permissions |
| Good for | one team's small tool | something many people rely on, or that needs data from elsewhere |

Start with a user app. Build an intranet app only when a user app cannot do the job — see
[Adding an app](#adding-an-app).

**What else is in the box**

- **Access management** (`/apps/access-admin/`): groups, permissions, one open-or-restricted
  switch per app, and the home page tiles — all in the browser, no deploy.
- **The Langdock connection** (`/api/mcp`): lets a Langdock chat build and change user apps,
  with the same sign-in and permissions as the browser.
- **AI without keys in the browser**: user apps call `/api/AppAI`, which holds the one
  Langdock key, adds a safety preamble, caps usage and keeps an audit line per call.

**What it runs on:** Azure Static Web Apps (Standard plan), its managed Azure Functions, one
Azure Storage account and Microsoft Entra ID. No server, no database, no build step: plain
HTML, CSS and JavaScript, and Node functions under `api/` with their own tests
(`cd api && npm test`). The GitHub workflow deploys `main` to production and every other
branch to one preview environment. Running cost is the Standard plan plus cents of storage,
plus your AI usage under your own Langdock contract.

## How access works, in four sentences

Every app has **one switch**: open (everyone who may sign in) or restricted (only the groups
you name). The home page has the same switch; whoever may not use it is an **app-only
guest** who can still open the apps given to them by link. Pages are checked at sign-in,
so a change reaches a page at the person's next sign-in; the functions behind them check
live, so a change reaches them within 30 seconds. Nothing about access is in the
repository: it lives in one document in Blob Storage, edited in access management.

## Configuration

Everything that makes the intranet yours is in **`site.config.json`** at the repository
root. Edit it, push to `main`, done.

| Setting | What it does |
|---|---|
| `name`, `tagline` | the headline and the sentence under it; the name is also what the AI is told hosts the apps |
| `adminEmails` | one or two addresses that always hold every permission: how the first sign-in works, and the way back in after a mistake. Everyone else is managed in access management |
| `langdock.url`, `langdock.integrationName` | where the "Build an app" button goes, and the name people tag in a chat (`@Intranet`) |
| `langdock.model` | the AI model user apps use |
| `brand.accent`, `brand.font` | the one accent colour (buttons, links, focus; its lighter shades are derived) and the font stack. The greys are fixed neutrals. Replace `assets/logo.svg` and `assets/favicon.svg` for your own logo and icon |

The file itself is never served to browsers: the pages get only the name, tagline and
Langdock link, through `/api/Site`.

## Adding an app

### A user app — first choice

The example **Hello Langdock** on the home page is one: the visitor's name, a shared counter
and an AI question, built the way any colleague would build theirs.

Nothing to install and nobody to ask. On the home page, press **Build an app in Langdock**
(or open a Langdock chat and tag `@Intranet`), describe the tool in plain words, and it is
live a minute later as a tile on your home page. It is private until you say "share it with
everyone" or "share it with anna@… and ben@…". Change it with another message; every version
is kept, so "roll back to the previous version" always works.

A user app is a static web page with, built in: the visitor's verified email, a shared
key-value and file store (300 keys, files up to 8 MB), AI through `/api/AppAI`, and an audit
line for every change. It cannot hold credentials, reach other systems or run on a schedule —
that is where an intranet app starts.

### An intranet app — for the more complex cases

Build one when the tool needs any of these: data from another system (an ERP export, a
nightly file, an API with a key), server-side logic or checks, permissions finer than
"who may open it", data many people edit at once, or something scheduled. Do not rebuild
what Microsoft 365 already does: a document library is SharePoint, a dashboard is Power BI,
an approval is Power Automate, and a link tile to it is the better intranet.

The example **Hello Intranet** (`apps/hello-intranet/`, `api/HelloIntranet/`,
`api/_tests/hello-intranet.test.js`) is the smallest complete one: copy those three and
rename. You need a developer tool for this: a code editor such as Visual Studio Code, or a
coding assistant such as Claude Code.

The steps:

1. **A folder** `apps/<id>/index.html`. The `<id>` is permanent: it is the address, the
   role and the registry key (lowercase, hyphens). Link `/assets/app-kit.css` first and
   copy the header from `apps/hello-intranet/index.html`.
2. **Functions** under `api/<AppName>/` (`function.json` + `index.js`), one folder per
   endpoint, shared code in `api/_shared/<id>/`. Every function checks permissions itself —
   the page's route rule does not protect the API:

   ```js
   const { getUserEmail } = require("../_shared/roles");
   const { canUseAnyApp, can } = require("../_shared/access");

   module.exports = async function (context, req) {
     const email = getUserEmail(req);
     if (!(await canUseAnyApp(email, ["<id>"]))) return void (context.res = { status: 403 });
     if (req.method !== "GET" && !(await can(email, "<id>", "write"))) return void (context.res = { status: 403 });
     // …
   };
   ```

   `api/HelloIntranet/index.js` is this pattern in full. `canUseAnyApp` follows the app's
   open/restricted switch. `can` asks for a group grant and
   ignores the switch: use it for what an open app must not give to everyone, like editing.
3. **Data**: small datasets as one JSON document in Blob Storage, written with
   `api/_shared/jsonDoc.js` so two people saving at once never lose a change, plus an audit
   line per write (`appendAuditLine`). Files through `api/_shared/blobFiles.js`. Secrets are
   Azure app settings, never files.
4. **Register it** in access management → **Apps** → **New**: name, path `/apps/<id>/`, open
   or restricted, and the tile text. Until then nobody can open it, you included.
5. **Push.** The route rule for the folder is generated on deploy, and the tests run first.
   Add a test for your permission checks to `api/_tests/` (copy `access.test.js`).
6. **Optional:** chat access (tools in `api/_shared/<id>/tools.js`, wired into
   `api/Mcp/index.js`), or AI (`chatComplete` from `api/_shared/langdock.js`, never from
   the browser).

A coding assistant does this well: [AGENTS.md](AGENTS.md) holds the rules it follows.

## Files at a glance

| Path | What |
|---|---|
| `site.config.json` | everything you configure |
| `index.html` | the home page: all apps as tiles |
| `apps/access-admin/` | access management |
| `apps/hello-intranet/` + `api/HelloIntranet/` | the example intranet app, to copy |
| `api/_shared/user-apps/examples/` | the example user app, created once on a fresh install |
| `api/` | the functions; `api/_shared/` shared code; `api/_tests/` the tests |
| `assets/` | `app-kit.css` (the look), `brand.css` (generated), `app-sdk.js` (helpers for user apps), logo, icon |
| `misc/` | `access-generate-routes.js`, `site-generate-brand.js`, `access-error.html` and `not-found.html` |
| [SETUP.md](SETUP.md) | setting it up, click by click |
| [AGENTS.md](AGENTS.md) | the rules of this codebase, for developers and coding assistants |
