# Intranet blueprint: MCP and vibe coding apps

A secure company portal for connecting Langdock via MCP and hosting vibe coding apps. Colleagues sign in once with their Microsoft
work account and see every app they may use on one home page. They build small apps of their
own by describing them in Langdock, and they work with connected apps and data by asking
Langdock instead of clicking through screens.

This repository is a GitHub template. To get your own intranet, follow [SETUP.md](SETUP.md).

## Repository overview: What you get

- A home page with one tile per app a person may open, and nothing else.
- Sign-in with the Microsoft work account people already use.
- User apps: small tools any colleague builds in Langdock in minutes, without a developer.
- Intranet apps: larger tools built in this repository, for what user apps cannot do.
- A Langdock connection that lets people work with the intranet by asking questions.
- Access management in the browser: who may open which app, set by administrators.
- AI inside apps, without any key reaching the browser.
- Your name, logo, colour and font, all configured in one file.

## MCP: The Langdock connection

The intranet is connected to Langdock through MCP, the Model Context Protocol. MCP is an open
standard that lets an AI assistant use another system's functions on behalf of the person
asking: look something up, list items, create or change a record. The intranet offers these
functions, called tools, and Langdock calls them when a question needs them. Each tool checks
who is asking and what they may do.

Today the connection offers two things: telling people who they are and which apps they may
open, and building, changing, sharing and deleting their own user apps.

It is built to be extended. Any intranet app can add tools of its own, and only the apps
connected this way are reachable from Langdock. Typical extensions:

- **Search** a knowledge base: "What is our process for returning a damaged delivery?"
- **List** from an internal app: "Which store openings are planned for next quarter?"
- **Create** in an internal tool: "Open an IT request: the receipt printer in store 12 is broken."
- **Update** company information: "Set the Lisbon renovation project to completed."

## Security and access

- **Single sign-on.** Everyone signs in with their Microsoft work account. Your Microsoft
  Entra ID settings decide who may sign in at all.
- **Access per app.** Every app is either open to everyone who may sign in, or restricted to
  the groups you name. An app nobody has registered cannot be opened by anyone.
- **Permissions managed in the browser.** Administrators maintain groups, members and rights
  in access management. Groups can include people by name or everyone with a given email
  domain. No code change and no deploy is needed.
- **The same rules everywhere.** The website and Langdock check the same permissions. What a
  person may not do on the website, they cannot do through Langdock either. Every server
  function checks permissions itself on each request, and a change takes effect within 30
  seconds.
- **No secrets in the browser.** Keys and passwords stored encrypted on the server. User apps reach AI
  only through the intranet, which adds a safety instruction and caps usage.
- **Changes are logged.** Every change to access settings, every change to a user app and
  every AI request is recorded with the verified email address of the person and the time.
- **User apps are private by default.** Their owner decides whether to share them with
  everyone or with named colleagues.

## Recommended way of working

Start in Langdock. Wherever you would normally send a presentation, an Excel file or
an HTML file, describe a user app instead: a form, a checklist, a tracker, a calculator. It
is live within a minute at a fixed address, keeps its data in one place and can use AI.
Change it with another message, and share it internally as needed. The last 20 versions are kept, so an earlier one can always
be brought back.

When a user app is not enough, you can also build an intranet app. It allows a richer interface, more
complex data handling, finer permissions and connections to internal systems such as an ERP
export or an internal API.

## Setup

Press **Use this template** on GitHub to create your organisation's own copy, then follow
[SETUP.md](SETUP.md). It takes about an hour, mostly forms in web portals, and assumes no
Azure knowledge.

The intranet runs on Azure today: Azure Static Web Apps for the website and its server
functions, Azure Storage for data and files, Microsoft Entra ID for sign-in. Running costs are the Static Web Apps
Standard plan, a few cents of storage and your Langdock usage.

> It is not tied to Azure. Sign-in, hosting and storage each sit in a few clearly separated
places, so moving to AWS, Google Cloud or another sign-in provider is a manageable project,
especially with an AI coding assistant.

## Building an intranet app

Use an AI coding assistant such as Claude Code or Codex. It reads [AGENTS.md](AGENTS.md),
which holds the rules of this codebase, and copies the example app Hello Intranet. A request
can be as short as this:

> Build an intranet app "store-contacts" following AGENTS.md, based on Hello Intranet. It
> lists every store with its manager, phone number and email address, searchable by city.
> Everyone may read it. Only the group Store Operations may edit entries. Add Langdock tools
> so people can ask for a store's contact details.

Afterwards, you can test and deploy the application with your chosen access rights.

## Configuration

Everything that makes the intranet yours is in `site.config.json`.

| Setting | What it does |
|---|---|
| `name`, `tagline` | the headline and the sentence under it; the name also tells the AI which intranet hosts the apps |
| `adminEmails` | one or two addresses that always hold every permission: how the first sign-in works, and the way back in after a mistake |
| `langdock.url`, `langdock.integrationName` | where the "Build an app" button leads, and the name people tag in Langdock (`@Intranet`) |
| `langdock.model` | the AI model user apps use |
| `brand.accent`, `brand.font` | the accent colour (its lighter shades are derived) and the font. Replace `assets/logo.svg` and `assets/favicon.svg` for your logo and icon |

## Files at a glance

| Path | What |
|---|---|
| `site.config.json` | everything you configure |
| `index.html` | the home page: all apps as tiles |
| `apps/access-admin/` | access management |
| `apps/hello-intranet/` and `api/HelloIntranet/` | the example intranet app, to copy |
| `api/` | the server functions; `api/_shared/` shared code; `api/_tests/` the tests |
| `api/Mcp/` | the Langdock connection: the tool list and `whoami` |
| `api/_shared/mcp/server.js` | the protocol handling behind it |
| `api/_shared/verifyToken.js` | the sign-in check for Langdock requests |
| `api/_shared/user-apps/` | the user-app tools, storage and access; `examples/` holds Hello Langdock |
| `assets/` | `app-kit.css` (the look), `brand.css` (generated), `app-sdk.js` (helpers for user apps), logo, icon |
| `misc/` | route and brand generators, and the error pages |
| [SETUP.md](SETUP.md) | the setup, step by step |
| [AGENTS.md](AGENTS.md) | the rules of this codebase, for developers and coding assistants |
