# Setup, click by click

Follow this once, top to bottom. It takes about an hour the first time, most of it waiting
for Azure. No Azure knowledge is assumed: every step is a form in a web portal, plus one
file to edit. There is no script to run and no database to prepare.

**The order, and why:**

| Step | What you do | Why it comes here |
|---|---|---|
| 1 | Create your repository | everything else deploys from it |
| 2 | Edit `site.config.json` | your name and your admin address must be in place before the first sign-in |
| 3 | Create a Storage account | where access settings and user apps are stored |
| 4 | Create the Static Web App | the website and its functions; connect it to GitHub |
| 5 | Register the intranet in Entra ID | the Microsoft sign-in, and who may sign in at all |
| 6 | Add the app settings | hand the secrets from steps 3–5 to the website |
| 7 | Sign in and give access | the site is live |
| 8 | Langdock API key | AI inside user apps |
| 9 | Langdock connection | colleagues build apps from a chat |
| 10 | Optional: your own domain | |

**What you need before you start**

| | |
|---|---|
| A GitHub account | with the right to create a repository in your organisation |
| An Azure subscription | with permission to create resources (Contributor on a resource group is enough) |
| Rights in Microsoft Entra ID | to create one app registration — or a colleague in IT who does step 5 for you |
| A Langdock workspace | for steps 8 and 9. The portal and access management work without it |
| A developer tool (later) | to build intranet apps: a code editor such as [Visual Studio Code](https://code.visualstudio.com/) with Git, or a coding assistant such as [Claude Code](https://claude.com/claude-code), and [Node.js](https://nodejs.org/) 20 or later. The setup itself works in the browser |

> **What it costs:** the Static Web Apps **Standard** plan per month, a few cents for storage,
> and the AI calls under your Langdock contract. The Free plan does not work: it cannot use
> your own Entra registration and cannot assign roles, which is how all access works here.

---

## Step 1 — Create your repository

This repository is a template. Every organisation gets its own copy, because every copy
carries its own configuration.

1. Open the blueprint repository on GitHub.
2. Click the green **Use this template** button at the top right → **Create a new
   repository**.
3. **Owner**: your organisation. **Repository name**: for example `acme-intranet`.
   **Visibility**: **Private**.
4. Click **Create repository**.

**Check:** you now have your own repository with the same files, and no connection back to
the template.

> **No template button available?** Copy it by hand:
> `git clone --depth 1 <blueprint-url> acme-intranet`, delete the `.git` folder, then
> `git init`, commit everything, create an empty private repository at
> <https://github.com/new> and push to it.

## Step 2 — Edit `site.config.json`

This one file holds everything that is specific to your organisation. You can edit it
straight in GitHub.

1. In your repository, open **`site.config.json`** and click the **pencil** (Edit).
2. Set **`name`** (the headline and the browser title, e.g. `ACME Intranet`) and
   **`tagline`** (one sentence under the headline).
3. Set **`adminEmails`** to **your own work address**, exactly as you sign in to Microsoft
   with it, for example `["anna.meier@acme.com"]`.
4. Leave `langdock` and `brand` as they are for now.
5. Click **Commit changes…** → **Commit changes** (to `main`).

**Check:** the file shows your values.

> **Why `adminEmails` matters now:** those addresses always hold every permission, whatever
> is saved later. That is how your very first sign-in gets into Access management with
> nothing set up yet, and it is the way back in if an admin ever removes their own rights.
> Keep it to one or two people; everyone else is managed in the browser afterwards.
>
> Every other key — the Langdock settings, the accent colour, the font — is explained in
> [README.md → Configuration](README.md#configuration).

## Step 3 — Create a Storage account

The Storage account holds the data: the access settings, the user apps and their data, and
the audit trails.

1. Open <https://portal.azure.com> → **Create a resource** → search **Storage account** →
   **Create**.
2. On **Basics**:
   - **Subscription**: yours.
   - **Resource group**: **Create new**, for example `rg-intranet`. You will put the Static
     Web App in the same group.
   - **Storage account name**: lowercase letters and digits only, for example
     `stacmeintranet`.
   - **Region**: one in your own jurisdiction, for example West Europe.
   - **Primary service**: Azure Blob Storage. **Performance**: Standard.
     **Redundancy**: Locally-redundant storage (LRS).
3. Click **Review + create** → **Create**. Wait for "Your deployment is complete" →
   **Go to resource**.
4. In the left menu: **Security + networking → Access keys** → click **Show** next to
   **key1** → copy the **Connection string**. Keep it in a scratch file; you need it in
   step 6.

**Check:** you have a connection string starting with `DefaultEndpointsProtocol=https;…`.

> **The connection string is a password.** It goes into the Azure configuration in step 6
> and nowhere else — never into the repository. You do not need to create any containers:
> the intranet creates them on first use.

## Step 4 — Create the Static Web App

The Static Web App serves the website and runs its functions. The repository already
contains the workflow that deploys to it (`.github/workflows/deploy.yml`).

**4a. Create it**

1. Azure portal → **Create a resource** → search **Static Web App** → **Create**.
2. On **Basics**:
   - **Resource group**: the one from step 3.
   - **Name**: for example `acme-intranet`.
   - **Plan type**: **Standard**.
   - **Region for Azure Functions API**: one near you, for example West Europe.
   - **Deployment details → Source**: **Other**.
3. Click **Review + create** → **Create** → **Go to resource**.
4. On the **Overview**, copy the **URL**, for example
   `https://polite-sand-0123.1.azurestaticapps.net`. This is your site address; you need it
   in steps 5 and 9.

> **Why Source "Other":** with "GitHub", Azure commits a second workflow of its own into your
> repository, which deploys the wrong folders. **Already chose GitHub?** Delete the file
> `.github/workflows/azure-static-web-apps-<name>.yml` from your repository, and later also
> the secret `AZURE_STATIC_WEB_APPS_API_TOKEN_<NAME>` Azure created (GitHub → Settings →
> Secrets and variables → Actions).

**4b. Check the settings**

1. In the left menu: **Settings → Configuration**.
2. Set:

   | Setting | Value | Why |
   |---|---|---|
   | Password protection | **Disabled** | the Microsoft sign-in protects the site |
   | Preview environments | **enabled** | every branch other than `main` deploys to a preview |
   | Enable configuration file changes | **enabled** | otherwise the access rules in `staticwebapp.config.json` are ignored |
   | Deployment authorization policy | **Deployment token** | the workflow deploys with the token from 4c |

3. Click **Apply** if you changed anything.

> **Build details** on the same page (App location, Api location) can be ignored: the
> repository's workflow sends its own values.

**4c. Connect GitHub**

1. In the left menu: **Overview** → **Manage deployment token** → copy the token.
2. In GitHub, your repository → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**:
   - **Name**: `AZURE_STATIC_WEB_APPS_API_TOKEN` (exactly this)
   - **Secret**: the token
   - Click **Add secret**.
3. GitHub → **Actions** tab → **Deploy to Azure Static Web Apps** (left) → **Run workflow**
   → **Run workflow**.
4. Wait for the green tick (about two minutes).

**Check:** the run is green and does **not** show a "Nothing was deployed" notice. Opening
your site address now leads to a Microsoft sign-in that fails — that is expected until
step 5 is done.

> **"Nothing was deployed"** means the workflow found no token: the secret name is not
> exactly `AZURE_STATIC_WEB_APPS_API_TOKEN`. The workflow tests and builds without it but
> skips the upload, so an unconfigured copy never shows a red X.

## Step 5 — Register the intranet in Microsoft Entra ID

This registration is the Microsoft sign-in. It also decides **who can sign in at all**: the
intranet lets in whoever Entra lets through, and Access management decides the rest.

**5a. Create the registration**

1. Azure portal → search **Microsoft Entra ID** → left menu **Manage → App registrations**
   → **New registration**.
2. **Name**: `Intranet`.
3. **Supported account types**: **Accounts in this organizational directory only**.
4. **Redirect URI**: platform **Web**, address `https://<your-site>/.auth/login/aad/callback`
   (your site address from step 4a, followed by `/.auth/login/aad/callback`).
5. Click **Register**.
6. On the overview page, copy the **Application (client) ID** and the **Directory (tenant)
   ID**.

> **Who can sign in:** "this organizational directory only" lets in everyone in your
> company's directory, including guests you invite. To allow only certain people: **Entra ID
> → Enterprise applications → Intranet → Properties → Assignment required: Yes**, then add
> users or groups under **Users and groups**.
>
> **Several tenants?** If your people sit in different Entra tenants (for example one per
> country), choose **Accounts in any organizational directory (Multitenant)** instead. Be
> aware that anyone with a work account at *any* company can then sign in. Restrict the
> **Intranet home page** and every app in Access management (step 7), so strangers get
> nothing. Skip 5c then.

**5b. Create the secret and the email claim**

1. Left menu **Certificates & secrets** → **Client secrets** → **New client secret** →
   description `swa`, expiry 24 months → **Add**.
2. Copy the **Value** immediately (it is shown only once).
3. Left menu **Token configuration** → **Add optional claim** → token type **ID** → tick
   **email** and **upn** → **Add**. Accept the prompt to turn on the Microsoft Graph
   permission.

> **Why the email claim:** the intranet identifies people by their email address. Without
> it, everyone lands on "no access".
>
> **Put a reminder in your calendar** for the secret's expiry date. When it expires, sign-in
> stops working until you create a new one and update `AAD_CLIENT_SECRET` (step 6).

**5c. Tell the site your tenant** (single tenant only)

1. In GitHub, open `staticwebapp.config.json` → pencil (Edit).
2. In `openIdIssuer`, replace `common` with your **Directory (tenant) ID** from 5a.6:
   `https://login.microsoftonline.com/<tenant-id>/v2.0`.
3. **Commit changes** (to `main`). This deploys again automatically.

**5d. Prepare the Langdock connection** (skip if you don't use Langdock)

1. Left menu **Expose an API** → next to **Application ID URI** click **Add** → accept
   `api://<client-id>` → **Save**.
2. **Add a scope**:
   - **Scope name**: `access_as_user`
   - **Who can consent**: Admins and users
   - Display name and description: for example "Use the intranet as the signed-in user"
   - **State**: Enabled → **Add scope**.
3. **Certificates & secrets** → **New client secret** → description `langdock`, 24 months →
   **Add** → copy the **Value**.

> **Why one registration for both:** the website and Langdock sign in the same people to the
> same application, so a second registration would only be a second thing to keep in step.
> One secret each means that rotating Langdock's secret never signs the whole company out.

> **Preview sign-in** (optional, for trying branches): branches other than `main` deploy to
> a preview address, shown under the Static Web App → **Settings → Environments** once a
> branch has been pushed. Add its callback as a second redirect URI: registration →
> **Authentication** → **Add URI** →
> `https://<preview-address>/.auth/login/aad/callback` → **Save**.

## Step 6 — Add the app settings

The website needs the secrets from steps 3 and 5. They are stored in Azure, never in the
repository.

1. Azure portal → your Static Web App → left menu **Settings → Environment variables**.
2. Click **+ Add** for each row, then **Apply**:

   | Name | Value |
   |---|---|
   | `AAD_CLIENT_ID` | the Application (client) ID from step 5a.6 |
   | `AAD_CLIENT_SECRET` | the `swa` secret from step 5b.2 |
   | `APP_DATA_STORAGE_CONNECTION_STRING` | the connection string from step 3.4 |
   | `LANGDOCK_API_KEY` | from step 8 — add it then |

3. Confirm the prompt. The functions restart, which takes a few seconds.

**Check:** the four names (or three, before step 8) are listed.

## Step 7 — Sign in and give access

1. Open your site address and sign in with the address you put in `adminEmails`.
2. You see the home page with tiles for **Access management**, the example intranet app
   **Hello Intranet** and the example user app **Hello Langdock**.
3. Open **Access management** (`/apps/access-admin/`):
   - **Apps**: every app with its switch — *everyone who may sign in* or *only the groups
     below* — and its home page tile. **New** adds an app or a link tile (for example to a
     SharePoint site or a Power BI report).
   - **Groups**: a group grants permissions. People join by name, or automatically **by
     email domain**.
   - **Users**: one person, their groups, and what that adds up to.
4. Make your first change and wait for **All changes saved**.

**Check:** `https://<your-site>/.auth/me` shows your address and the roles `signed-in`,
`intranet` and `access-admin`.

> **How changes arrive:** pages follow at a person's next sign-in (the "no access" page has a
> button that signs them out and back in); everything behind the pages follows within 30
> seconds. Until the first save in Access management, built-in defaults apply: the home page
> open to everyone who can sign in, Access management restricted, Hello Intranet open.
>
> **App-only guests:** restricting **Apps → Intranet home page** turns everyone outside its
> groups into guests, who only open the apps given to them, by link.
>
> **The examples:** remove Hello Langdock with the **Delete** button on its tile. Remove
> Hello Intranet by deleting `apps/hello-intranet/`, `api/HelloIntranet/` and
> `api/_tests/hello-intranet.test.js` from the repository, and its entry in Access
> management.

## Step 8 — Langdock API key

User apps use AI through one server-side key, so no key ever reaches a browser.

1. In Langdock: **Settings → API keys** (a workspace admin may have to do this) → create a
   key for the intranet → copy it.
2. Azure portal → Static Web App → **Settings → Environment variables** → **+ Add**:
   `LANGDOCK_API_KEY` = the key → **Apply**.

**Check:** open **Hello Langdock** on the home page and press **Ask**. An answer appears.

> The model is `langdock.model` in `site.config.json`; the app setting `APP_AI_MODEL`
> overrides it without a deploy. Each person may make 200 AI calls a day.

## Step 9 — Langdock connection

This lets colleagues build user apps by describing them in a Langdock chat. It signs in
with the same registration from step 5 (you need 5d done).

**9a. Add the integration**

1. In Langdock: **Settings → Integrations → MCP** → **Add MCP server**.
2. Fill in:

   | Field | Value |
   |---|---|
   | Name | `Intranet` — people tag it in a chat as `@Intranet` |
   | Server URL | `https://<your-site>/api/mcp` |
   | Transport (if asked) | Streamable HTTP |
   | Authentication | OAuth 2.0 (manual) |
   | Authorization URL | `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize` |
   | Token URL | `https://login.microsoftonline.com/organizations/oauth2/v2.0/token` |
   | Client ID | the Application (client) ID from step 5a.6 |
   | Client secret | the `langdock` secret from step 5d.3 |
   | Scope | `api://<client-id>/access_as_user` |

3. Under **Custom headers**, add exactly:

   ```
   X-Mcp-Authorization: Bearer {{ access_token }}
   ```

**9b. Allow Langdock's sign-in**

1. Langdock shows a **redirect URL** in the form. Copy it.
2. In Entra: your `Intranet` registration → **Authentication** → under **Web** click **Add
   URI** → paste it → **Save**.
3. Back in Langdock: save the integration and click **Connect**. Sign in with Microsoft once.

**Check:** in a Langdock chat, tag `@Intranet` and ask *"Who am I on the intranet?"* — the
answer names your address. Then try *"Build me a small app that collects supplier
complaints in a form and shows them in a table."* You get a link, and a new tile on your
home page.

> **Why the custom header:** Azure Static Web Apps replaces the standard `Authorization`
> header before the intranet's code sees it, so the token travels in this one.
>
> **Why `organizations` in the URLs:** it works for single and multitenant registrations.
>
> **Another name than `Intranet`?** Set `langdock.integrationName` in `site.config.json`, so
> the home page and its **Build an app** button use the same name.
>
> **After a change to the tools** (a developer changed a tool or its description), open the
> integration in Langdock and re-sync its tools: Langdock keeps its own copy of the list.

## Step 10 — Optional: your own domain

1. Static Web App → **Settings → Custom domains** → **+ Add** → **Custom domain on other
   DNS** → enter the host name, for example `intranet.acme.com`.
2. Azure shows a `CNAME` record. Have your DNS administrator create it, then click
   **Validate**. The certificate is issued automatically.
3. In Entra: registration → **Authentication** → **Add URI**:
   `https://intranet.acme.com/.auth/login/aad/callback` → **Save**. Keep the old one until
   the new address works.
4. In Langdock: change the integration's **Server URL** to `https://intranet.acme.com/api/mcp`.

---

## When something does not work

| Symptom | Cause and fix |
|---|---|
| A Microsoft error at sign-in | Entra refuses the person: another tenant on a single-tenant registration, not assigned while "Assignment required" is on, or the redirect URI (step 5a.4) does not match the address exactly |
| "No access" right after signing in | the home page is restricted and you are in none of its groups, or the last deploy failed so an older `site.config.json` is live — check GitHub → Actions. Addresses in `adminEmails` always get in |
| Endless redirect loop at sign-in | `/api/GetRoles` must stay `anonymous` in `staticwebapp.config.json` |
| A new app shows "no access" for everyone | it is not registered in Access management yet |
| A permission change has no effect on a page | the person has to sign out and back in; the "no access" page has the button |
| Everything shows "no access" after editing `staticwebapp.config.json` | invalid JSON: Azure ignores the whole file. Undo the edit or fix it, and push again |
| No tiles, or Access management cannot save | `APP_DATA_STORAGE_CONNECTION_STRING` is missing or wrong (step 6) |
| Red deploy: "Test the API" | a test failed; the log names it. Nothing was deployed |
| Red deploy: "Deployment Canceled" | two runs deployed at once; look for a green run of the same commit |
| Langdock: "Unauthorized" | the custom header (9a.3) is missing, or the client ID differs from `AAD_CLIENT_ID`. The app setting `MCP_DEBUG_AUTH=true` shows the reason — remove it afterwards |
| Langdock: "invalid scope" | step 5d is missing, or the scope in Langdock is spelled differently |
| AI in a user app fails | `LANGDOCK_API_KEY` is missing or expired (step 8). `APP_DEBUG_ERRORS=true` shows the detail |
