# Intranet blueprint

**This repository is a GitHub template.** Do not develop in it: press **Use this template**
to give a brand its own copy (step 1 of [SETUP.md](SETUP.md)), then make that copy theirs.
Improvements every brand should get are made here and pulled into the copies deliberately,
not the other way around.

A small, complete intranet you can host yourself: a home page, a knowledge base, an access
management app, and — the part that makes it worth copying — a way for colleagues to build
their own little apps by describing them in a Langdock chat, with AI they can call from
those apps without ever touching an API key.

It is a stripped-down copy of MW Holding's intranet, reduced to the parts that generalise.
Nothing about MW Holding is left in it: one file holds the domains, one file holds the
colours, and there is no build step to learn.

## What you get

| | |
|---|---|
| **Home page** | Tiles for the apps a visitor may open, plus a search box across the knowledge base. Driven by two JSON files, not by code. |
| **Knowledge base** (`/apps/wiki/`) | Folders, Markdown pages, file attachments, full-text search, an audit trail, and an "rewrite with AI" button. Readable and writable from a Langdock chat as well as the browser. |
| **My apps** (`/apps/my-apps/`) | The directory of apps colleagues built themselves. |
| **Access management** (`/apps/access-admin/`) | Groups, permissions, per-app open-or-restricted — changed in the browser, effective at the next sign-in, no deploy and no code change. |
| **User apps** (`/api/a/<slug>/`) | A colleague describes a tool in a Langdock chat; it is live immediately at its own URL, private until they share it. It gets a key-value and file store, the signed-in visitor's identity and an AI endpoint. No git, no deploy, no involvement from whoever maintains the intranet. |
| **MCP server** (`/api/mcp`) | The single door for chat-side access: knowledge base tools, search, `whoami`, and the app-building tools. Same permissions as the browser. |
| **AI functions** | `api/AppAI` for the apps, `api/AiEdit` for the knowledge base. One server-side key, quotas, audit, and a safety preamble that app authors cannot remove. |

## What it runs on

Azure Static Web Apps (Standard) with managed Azure Functions, Microsoft Entra ID for
sign-in, and one Azure Storage account for data and files. Deployment is a GitHub Actions
workflow that is already in the repository. There is no server to patch, no database to
run, no build pipeline: plain HTML, CSS and JavaScript, and Node functions under `api/`.

Running cost is the Standard plan per month plus cents of storage, plus whatever your AI
calls cost under your own Langdock contract.

## Start here

1. **[SETUP.md](SETUP.md)** — click by click, from an empty GitHub repository to a working
   intranet with the Langdock connection. Assumes no Azure knowledge.
2. **[BRANDING.md](BRANDING.md)** — make it look like your company: one CSS file, one JSON
   file, two image files.
3. **[ADDING-AN-APP.md](ADDING-AN-APP.md)** — the checklist for a new app, and how to
   decide whether it should be an app in this repository at all.
4. **[CLAUDE.md](CLAUDE.md)** — the rules of this codebase, written for whoever (or
   whatever) writes the next change. Worth reading even if you never use an AI assistant:
   it is the shortest description of how the thing hangs together.

## The three ideas worth understanding

**Route rules protect pages, permissions protect data.** Every `/apps/<name>/` path is
guarded by a rule requiring the role `<name>`, generated at deploy time from the folder
names. Who holds that role is decided at sign-in from a document in Blob Storage, so
opening or closing an app is a change in the browser, not a deploy. Because everything runs
on one origin, **every API function checks permissions itself** — a page gate alone is
decorative.

**The chat is a second front door, not a shortcut.** The MCP server checks the same
permissions as the browser, from the same document. Read access is checked as carefully as
write access: search, an attachment link and an audit trail can all leak a page whose own
gate is closed.

**Colleagues should not have to wait for a developer.** The user apps exist so that the
person with the problem can build the small tool themselves, in a chat, within their own
permissions, with the platform providing identity, storage, AI and an audit trail. That is
the part of this blueprint that changes how much gets done; the knowledge base is just a
good example of how an app in this repository is built.

## What was deliberately left out

The original has more apps (a portfolio register, a document vault with reminder emails, a
location-intelligence map, a vendor register with contract extraction, per-brand process
documentation) and the Microsoft Graph, SharePoint and email integrations they need. None
of that is here. The blueprint keeps the platform and one example app, so you add what your
company actually needs instead of deleting what it does not.
