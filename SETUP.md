# Setup, click by click

Follow this once, top to bottom. It takes about 75 minutes the first time, most of it
waiting for Azure. No prior Azure knowledge is assumed, and nothing here needs a
developer: every step is a form in a web portal, plus three files to edit. There is no
script to run and no database to prepare.

**What you need before you start**

| | |
|---|---|
| A GitHub account | and the right to create a repository in your organisation |
| An Azure subscription | with permission to create resources (Contributor on a resource group is enough) |
| Rights in Microsoft Entra ID | to create one app registration, or a colleague in IT who can do step 5 for you |
| A Langdock workspace | only for the AI and chat parts (steps 8 and 9). Everything else works without it |

**What it will cost.** Static Web Apps Standard is billed per app per month, the Storage
account costs cents for this amount of data, and the AI calls are billed by your Langdock
contract. Check the Azure pricing page for the current Standard rate. The Free plan will
not work: it cannot use your own Entra registration and cannot assign roles with a
function, which is how all access control here works.

---

## Step 1 — Create your repository

This repository is a GitHub template, not somewhere to work directly: every brand gets its
own copy, because every copy carries its own domains, branding and access.

1. On <https://github.com/mwholding/mwh-blueprint>, click the green **Use this template**
   button at the top right → **Create a new repository**.
2. **Owner**: your organisation. **Repository name**: for example `acme-intranet`.
   **Visibility**: **Private**. → **Create repository**.
3. That is it. Your copy starts with its own history, no connection back to this repository
   and nothing to delete. Clone it to your machine, or edit the files straight in GitHub for
   the three changes in step 2.

No access to the template, or you would rather not use the button? Copy it once by hand:

```bash
git clone --depth 1 https://github.com/mwholding/mwh-blueprint acme-intranet
cd acme-intranet
rm -rf .git          # start your own history instead of carrying the blueprint's
git init
git add .
git commit -m "Intranet from the blueprint"
git branch -M main
```

Then create the empty private repository at <https://github.com/new> (leave "Add a README"
unchecked) and push to it:

```bash
git remote add origin https://github.com/<org>/<repo>.git
git push -u origin main
```

## Step 2 — Make it yours (3 files)

Edit these before the first deploy. There is no database to prepare and no script to run:
who administers the intranet is part of this configuration. Details in
[BRANDING.md](BRANDING.md).

1. **`api/_shared/config.js`** — the only company-specific file in the code.
   - `ALLOWED_DOMAINS`: every email domain that may sign in, lowercase, no `@`. Someone
     whose domain is missing gets a 403 no matter what else is configured.
   - `ADMIN_EMAILS`: **your own work address**, the one you sign in to the intranet with.
     Everyone listed here holds every permission, including access management, whatever is
     stored later. It is how the first sign-in works with nothing set up yet, and the way
     back in if an admin ever removes their own rights. Keep it to one or two people:
     everyone else is managed in the browser afterwards. An address here may sign in even
     if its domain is missing above, so a typo cannot lock out the person fixing it.
   - `ORG_NAME`: how your company is named to the AI ("hosted on X's own infrastructure").
   - `SITE_ORIGIN`: leave it for now, come back in step 6 with the real address.
2. **`site.json`** — the name, the sentence under the headline, the support address.
3. **`assets/brand.css`** — your colours and fonts. Replace `assets/logo.svg` and
   `assets/favicon.svg` with your own logo and mark.

Commit and push. Nothing is deployed yet, so nothing can break.

## Step 3 — Create the Storage account

This is where the data lives: the access document, the knowledge base, uploaded files, the
user apps, the audit trails.

1. <https://portal.azure.com> → **Create a resource** → search **Storage account** →
   **Create**.
2. **Basics**: pick your subscription, create or pick a resource group (for example
   `rg-intranet`), name the account (lowercase letters and digits only, for example
   `stacmeintranet`), pick a region in your own jurisdiction (for example West Europe),
   **Primary service**: Azure Blob Storage, **Performance**: Standard,
   **Redundancy**: Locally-redundant storage (LRS) is enough.
3. **Review + create** → **Create**. Wait for "Your deployment is complete", then
   **Go to resource**.
4. Left menu → **Security + networking → Access keys** → **Show** next to key1 →
   copy the **Connection string**. Keep it in a scratch file for step 6.

You do not need to create any containers: the code creates `app-data` and
`intranet-files` on first use.

> The connection string is a credential. It goes into the Azure configuration in step 6 and
> nowhere else, never into the repository.

## Step 4 — Create the Static Web App and connect GitHub

1. Azure portal → **Create a resource** → search **Static Web App** → **Create**.
2. **Basics**:
   - Same subscription and resource group as the Storage account.
   - **Name**: for example `acme-intranet`.
   - **Plan type**: **Standard**. (Free cannot do custom authentication or roles.)
   - **Region** for the managed functions: one near you, for example West Europe.
   - **Deployment details → Source**: **Other**. We deploy with the workflow that is
     already in the repository, so let Azure create nothing.
3. **Review + create** → **Create** → **Go to resource**.
4. On the overview, copy the **URL** (something like
   `https://polite-sand-0123.6.azurestaticapps.net`) — that is your site address until you
   add a custom domain.
5. Left menu → **Overview → Manage deployment token** → copy the token.
6. In GitHub: your repository → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**.
   - **Name**: `AZURE_STATIC_WEB_APPS_API_TOKEN` (exactly this)
   - **Secret**: the token you copied
   - **Add secret**
7. GitHub → **Actions** tab → the workflow **Deploy to Azure Static Web Apps** →
   **Run workflow** (or just push a commit). Wait for the green tick.

Opening the site now sends you to a Microsoft sign-in that fails, because the Entra
registration does not exist yet. That is the next step.

## Step 5 — Register the intranet in Microsoft Entra ID

**One registration for everything.** The same app registration carries the website sign-in
*and* the Langdock connection from step 9. It is the same application and the same people,
so a second registration would only be a second thing to keep in step (and a second request
to whoever administers Entra). Points 1 to 8 are the sign-in; points 9 and 10 prepare the
Langdock side, which you finish in step 9 once Langdock has shown you its redirect URL.

1. Azure portal → search **Microsoft Entra ID** → left menu **Manage → App registrations**
   → **New registration**.
2. **Name**: `Intranet`.
3. **Supported account types**:
   - One Entra tenant only → **Accounts in this organizational directory only**.
   - Several tenants (common when brands are separate companies) → **Accounts in any
     organizational directory (Any Microsoft Entra ID tenant – Multitenant)**.
4. **Redirect URI**: select **Web** and enter, using your address from step 4.4:

   ```
   https://<your-site>.azurestaticapps.net/.auth/login/aad/callback
   ```

5. **Register**. On the overview page copy the **Application (client) ID**. You will use
   this one value twice: as `AAD_CLIENT_ID` in step 6, and as the client id Langdock signs
   in with in step 9.
6. Left menu → **Certificates & secrets** → **Client secrets** → **New client secret** →
   description `swa`, expiry 24 months → **Add** → copy the **Value** immediately (it is
   shown once).
7. Left menu → **Token configuration** → **Add optional claim** → token type **ID** →
   tick **email** and **upn** → **Add**, and accept the prompt to turn on the required
   Microsoft Graph permission. Without an email in the token the intranet cannot tell who
   you are, and everyone lands on "no access".
8. Single tenant only (point 3 above, first option): open `staticwebapp.config.json` in the
   repository and replace `common` in `openIdIssuer` with your tenant ID (Entra ID →
   Overview → **Tenant ID**), then commit and push. Multitenant: leave it as it is.

Now the two additions that let the same registration serve Langdock as well. Skip them if
you are not connecting Langdock at all; you can come back and add them any time.

9. Left menu → **Expose an API** → next to "Application ID URI" click **Add** → accept the
   proposed `api://<client-id>` → **Save**. Then **Add a scope**:
   - **Scope name**: `access_as_user`
   - **Who can consent**: Admins and users
   - Admin and user consent display name and description: something like
     "Use the intranet as the signed-in user"
   - **State**: Enabled → **Add scope**.
   - Copy the full scope string, `api://<client-id>/access_as_user`.
10. **Certificates & secrets** → **New client secret** → description `langdock`, expiry
    24 months → **Add** → copy the **Value**. A second secret in the same registration, not
    a reused one: rotating the Langdock secret then never logs the whole company out of the
    website, and revoking Langdock's access is one click without touching sign-in.

## Step 6 — Fill in the Azure configuration

Azure portal → your Static Web App → left menu **Settings → Environment variables**
(older portals: **Configuration**) → **+ Add** for each row, then **Apply**/**Save**.

| Name | Value | Needed for |
|---|---|---|
| `AAD_CLIENT_ID` | the Application (client) ID from step 5.5 | sign-in |
| `AAD_CLIENT_SECRET` | the secret value from step 5.6 | sign-in |
| `APP_DATA_STORAGE_CONNECTION_STRING` | the connection string from step 3.4 | all data |
| `LANGDOCK_API_KEY` | see step 8 | the AI features |

There is deliberately no setting for the Langdock connection: the MCP endpoint validates
tokens against `AAD_CLIENT_ID`, because it is the same registration. (`MCP_OAUTH_AUDIENCE`
exists as an override for the one case that needs it, a separate registration for Langdock.)

Saving restarts the functions, which takes a few seconds. Also set `SITE_ORIGIN` in
`api/_shared/config.js` to your real address now (step 2), commit and push.

## Step 7 — First sign-in and check

1. Open your site. Sign in with the address you put in `ADMIN_EMAILS` in step 2.
2. You should see the home page with every tile, because that address holds every
   permission.
3. Open `https://<your-site>/.auth/me`. It shows your email and your roles. Expect at
   least `intranet`, `access-admin`, `my-apps`, `wiki`.
4. Open `/apps/access-admin/`. Until someone saves here for the first time, the intranet
   runs on the built-in defaults: the site open to your allowed domains, *My apps* open to
   everyone, the knowledge base and access management restricted. Your first save writes
   that document to storage and it becomes the only truth from then on. Add colleagues:
   - **Users** tab: add an email, tick the groups they belong to.
   - **Groups** tab: a group can also be filled automatically **by email domain** — the
     practical way to give access to hundreds of people nobody has listed by name.
   - **Apps** tab: switch an app between *any signed-in staff member* and *only the groups
     below*. This takes effect at the person's next sign-in, with no deploy.
5. Anyone whose permissions you change while they are signed in has to sign out and back
   in (`/.auth/logout`) before the change reaches their session. A 403 page explains this
   and has a button that does it.

## Step 8 — Langdock: the AI features

The knowledge base's "rewrite with AI" and everything the self-built apps do with AI go
through one server-side key, so no key ever reaches a browser.

1. In Langdock, open **Settings → API keys** (a workspace admin may have to do this) and
   create a key for the intranet.
2. Put it into the Azure configuration as `LANGDOCK_API_KEY` (step 6) and **Apply**.
3. Optional: `LANGDOCK_MODEL` overrides the default model, `APP_AI_MODEL` overrides it for
   the user apps only.

Check it: open the knowledge base, create a page, type a sentence, and use the AI rewrite
button. If the key is missing you get a clear error rather than silence.

## Step 9 — Langdock: the MCP connection

This is what lets a Langdock chat read and write the knowledge base and build the small
apps. The chat authenticates as a user against Entra directly rather than through the
website's session, but against the **same registration** you created in step 5 — so there is
nothing new to register here, only one redirect URI to add once Langdock shows it to you.

**9a. What you need from step 5**

| | |
|---|---|
| Client ID | the Application (client) ID from step 5.5 (the same one as `AAD_CLIENT_ID`) |
| Client secret | the `langdock` secret from step 5.10 |
| Scope | `api://<client-id>/access_as_user` from step 5.9 |

If you skipped points 9 and 10 of step 5, do them now: without the exposed scope Entra has
nothing to issue a token for, and the connection fails with "invalid scope".

**9b. Add the integration in Langdock**

1. In Langdock: **Settings → Integrations → MCP** (naming varies slightly by version) →
   **Add MCP server**.
2. **Name**: `Intranet` — this is the name colleagues will tag in a chat as `@Intranet`.
   If you name it something else, say so on the *My apps* page, which mentions
   `@Intranet` in its instructions.
3. **Server URL**: `https://<your-site>/api/mcp`
4. **Authentication**: **OAuth 2.0 (Manual)** and fill in:

   | Field | Value |
   |---|---|
   | Authorization URL | `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize` |
   | Token URL | `https://login.microsoftonline.com/organizations/oauth2/v2.0/token` |
   | Client ID | the Application (client) ID from step 5.5 |
   | Client secret | the `langdock` secret from step 5.10 |
   | Scope | `api://<client-id>/access_as_user` |

   Use `organizations` in both URLs, not your tenant ID, if your people sit in different
   tenants — with a tenant ID, everyone from another tenant fails with "the account needs
   to be added as an external user".
5. **Custom headers** — this one is not optional:

   ```
   X-Mcp-Authorization: Bearer {{ access_token }}
   ```

   Azure Static Web Apps overwrites the standard `Authorization` header with an internal
   token of its own before your code ever sees it (a documented platform bug), so the
   intranet reads the token from this custom header instead.
6. Langdock shows you a **redirect URL** for the OAuth flow. Copy it, go back to the
   `Intranet` registration in Entra → **Authentication** → under the existing **Web**
   platform click **Add URI** → paste it → **Save**. The registration then has two redirect
   URIs, the SWA callback from step 5.4 and this one; that is expected and correct. Do not
   guess this URL, read it from the Langdock form.
7. Save the integration and connect it. Langdock sends you through a Microsoft sign-in
   once; afterwards the chat acts as you.

**9c. Try it**

In a Langdock chat, tag `@Intranet` and ask:

- *"Who am I on the intranet and what may I do?"* → the `whoami` tool answers with your
  verified address and your permissions.
- *"List the knowledge base folders."*
- *"Build me a small app that collects supplier complaints in a form and shows them in a
  table."* → you get a link that works immediately, private to you until you share it.

Permissions are the same as in the browser, read from the same access document — a chat is
not a way around a gate. Unlike the browser, a change in access management takes effect
here immediately, without signing out.

## Step 10 — Optional: a custom domain

**Custom domain** (for example `intra.example.com`):

1. Static Web App → **Settings → Custom domains** → **+ Add** → **Custom domain on other
   DNS** → enter the host name.
2. Azure shows a `CNAME` record. Have your DNS administrator create it, then click
   **Validate**. The certificate is issued automatically.
3. Add the new address as a further redirect URI on the `Intranet` registration
   (step 5.4, keep the old one until you are sure), set `SITE_ORIGIN` in
   `api/_shared/config.js`, and update the server URL in the Langdock integration. The
   Langdock redirect URI does not change, it points at Langdock and not at your site.

---

## Verification checklist

| Check | Where | Expected |
|---|---|---|
| Deploy is green | GitHub → Actions | last run succeeded |
| Sign-in works | your site | you land on the home page, not on a Microsoft error |
| You are the admin | `/apps/access-admin/` | it opens for you without anything having been granted |
| Roles are assigned | `/.auth/me` | your email plus `intranet` and your app roles |
| Data storage works | `/apps/wiki/` | you can create a page and it survives a reload |
| Access control works | `/apps/access-admin/` | opens for you, and 403 for a colleague without the permission |
| Attachments work | a knowledge base page | upload a PDF, download it again |
| AI works | knowledge base | the AI rewrite button returns text |
| MCP works | a Langdock chat | `@Intranet` "who am I on the intranet?" answers correctly |
| User apps work | Langdock, then `/apps/my-apps/` | the app you asked for opens and is listed |

## When something does not work

| Symptom | Cause and fix |
|---|---|
| Endless redirect loop at sign-in | `/api/GetRoles` is not `anonymous` in `staticwebapp.config.json`. It must be, or every login loops. |
| "No access" page right after signing in | your email domain is not in `ALLOWED_DOMAINS` (`api/_shared/config.js`, then push), or the address is not in any group in `/apps/access-admin/`. Your own address belongs in `ADMIN_EMAILS`. |
| A new app under `apps/` returns 403 for everyone | it is not registered. An app id with no entry in `/apps/access-admin/` hands out no role, so the page stays closed until you register it. |
| 401 | not signed in. 403 means signed in without the role — a different problem. |
| A permission change has no effect | the person's session still carries the old roles. Sign out via `/.auth/logout` and back in. |
| Everything is 403 after editing the config file | invalid JSON in `staticwebapp.config.json` makes Azure ignore the whole file. Validate it (`node -e "JSON.parse(require('fs').readFileSync('staticwebapp.config.json'))"`) and push again. |
| Nothing saves, everything reads empty | `APP_DATA_STORAGE_CONNECTION_STRING` is missing or wrong. The code fails closed on purpose rather than pretending. |
| Red deploy saying "Deployment Canceled" | two runs deployed at once and Azure cancelled the loser. Check whether another run for the same commit went green before looking for a real fault. |
| The MCP connection returns "Unauthorized" | the custom header from step 9b.5 is missing, or Langdock holds a different client id than `AAD_CLIENT_ID` (the endpoint validates the token against that registration). Set `MCP_DEBUG_AUTH` to `true` temporarily to get the reason in the response, then remove it. |
| Langdock says "invalid scope" or offers no consent screen | points 9 and 10 of step 5 are missing: no Application ID URI, no `access_as_user` scope, or the scope string in Langdock does not match it character for character. |
| AI calls fail | `LANGDOCK_API_KEY` missing or expired. Set `APP_DEBUG_ERRORS` to `true` temporarily for the detail. |
