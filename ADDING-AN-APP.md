# Adding an app

## First: should it be an app in this repository?

Three routes, in order of how little work they are. Take the highest one that fits.

1. **A user app, built in a Langdock chat.** Someone describes the tool, it is live in
   minutes with its own storage, identity, AI and audit trail, and the person who needs it
   owns it. Right for anything one team uses: a form plus a list, a checklist, a small
   calculator, a review of documents. No developer, no deploy, no entry in this repository.
2. **A page in the knowledge base.** If the "app" is really a document — a checklist people
   read, a procedure, a reference table — write it as a page. It gets search, attachments,
   an audit trail and chat access for free.
3. **An app in this repository.** Right when it needs its own data model, its own
   permissions, or a server-side integration: a register that many people edit, something
   that has to be gated separately, something that talks to another system with credentials.
   That is what the rest of this file is about.

And one thing not to do: do not rebuild what Microsoft 365 already does. A document library
is SharePoint, a dashboard on numbers you already have is Power BI, an approval is Power
Automate. A tile linking there is a better intranet than a worse copy of it.

## Checklist for an app in this repository

1. **Create the folder.** `apps/<id>/index.html`. The `<id>` is permanent: it is the URL,
   the role name and the registry key. Lowercase, hyphens, no spaces.

   In the `<head>`:

   ```html
   <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
   <link rel="stylesheet" href="/assets/app-kit.css">
   ```

   Copy the header block ("← Back to intranet" with the logo) from `apps/wiki/index.html`.
   There is no templating in this repository on purpose; the block is nine lines.

2. **Write the API functions.** One folder per function under `api/`, each with a
   `function.json` and an `index.js`. Copy the shape from `api/Wiki/`. Azure only finds a
   `function.json` exactly one level under `api/`, so a function cannot live in a
   subfolder — prefix related functions instead (`api/MyAppItems`, `api/MyAppComments`), and
   put shared code in `api/_shared/<myapp>/`.

3. **Check permissions inside every function.** Not optional, and not covered by the route
   rule: everything runs on one origin, so any page can call any endpoint.

   ```js
   const { getRoles, getUserEmail } = require("../_shared/roles");
   const { canUseApp } = require("../_shared/access");

   if (!getRoles(req).includes("intranet")) return forbidden();          // signed in at all
   if (!(await canUseApp(getUserEmail(req), "<id>", "write"))) return forbidden();
   ```

   Reading counts. A search endpoint, an audit trail, an attachment link and an MCP tool can
   each hand out content whose page is gated; each has to ask the same question.

4. **Store the data the boring way.** A small dataset that people edit: a JSON document in
   Blob Storage through `api/_shared/jsonStore.js`, plus an audit line per write. Files:
   `api/_shared/blobFiles.js`. Anything that needs real concurrency, reporting or a
   different lifecycle does not belong in a JSON blob — say so instead of building around
   it.

5. **Register the app.** In `/apps/access-admin/` → **Apps** → **New**: name and path
   (`/apps/<id>/*`). That creates the role, makes it selectable everywhere, and decides
   whether the app is open to all staff or restricted to groups. No code change, no deploy.
   **Not optional**: an id with no registry entry hands out no role, so an unregistered app
   is a 403 for everyone including you. That is the safe direction, and the symptom is
   obvious, but it does mean this step is part of shipping the app rather than an afterthought.

6. **Add the tile.** One entry in `apps/apps.json`: `name`, `desc`, `url`. Nothing about
   access — the home page derives that from the role and the registry.

7. **The route rule comes by itself.** `misc/generate-app-routes.js` runs on every deploy
   and writes one rule per folder under `apps/`. Run `node misc/generate-app-routes.js
   --check` locally if you want to see whether the committed config is up to date.

8. **Optional: chat access.** To let a Langdock chat use the app, define tools in
   `api/_shared/<myapp>/mcpTools.js` with `TOOLS`, `handles(name)` and
   `call(name, args, email)`, then push them into the list in `api/Mcp/index.js` and
   dispatch them from the default case — the same way `userAppTools.js` is wired in. Each
   tool checks permissions itself. A tool description is the only documentation the model
   gets, so write it for a reader who cannot see the code.

9. **Optional: AI in the app.** Call `chatComplete` from `api/_shared/langdock.js` in a
   function. Never from the browser: the key is server-side, and it stays that way. Copy the
   guardrails from `api/AppAI` if end users can influence the prompt — a fixed safety
   preamble, an input cap, a clamped output, a per-user daily quota and an audit line.

## A worked example, shortest possible

A register of, say, contract renewals, editable by a group:

- `apps/renewals/index.html` — the page, using the app kit.
- `api/Renewals/{function.json,index.js}` — GET returns the array, PUT overwrites it after
  `canUseApp(email, "renewals", "write")`, every write appends to `renewals-audit.jsonl`.
- Register `renewals` in access management, restricted, with a group holding
  `{ app: "renewals", action: "write" }` and another holding `read`.
- One tile in `apps/apps.json`.
- Register `renewals-audit.jsonl` in `api/Audit`'s `KINDS` if the page should show its own
  history.

That is roughly 150 lines of new code, no infrastructure, and it is gated, audited and
chat-ready.

## Naming and vocabulary

Pick the words once and use them everywhere: in the tile, the page title, the role, the
folder and the tool descriptions. Half the confusion in an intranet is two names for the
same thing.
