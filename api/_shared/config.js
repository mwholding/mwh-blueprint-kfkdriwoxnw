// ============================================================================
//  EDIT THIS FILE FIRST. Together with assets/brand.css and site.json it is
//  everything you have to change to make this intranet yours. Nothing else in
//  api/ carries a company-specific value.
// ============================================================================

// 1) WHO MAY SIGN IN. The email domains that are allowed into the intranet at all.
//    Checked for both login paths so they can never drift apart:
//      - api/GetRoles          (browser login through Entra ID)
//      - _shared/verifyToken   (OAuth bearer tokens from Langdock / MCP clients)
//    A person whose email domain is not on this list gets no roles and sees a 403,
//    no matter what else is configured. Lowercase, no "@".
const ALLOWED_DOMAINS = [
  "example.com",
  "example.onmicrosoft.com",
];

// 2) WHO ADMINISTERS ACCESS. These addresses always hold every permission, including
//    access management, whatever the stored access document says. That is deliberate:
//    it removes the chicken-and-egg problem of a fresh install (somebody has to be able
//    to open /apps/access-admin/ before anyone has been granted anything) and it is the
//    way back in if an admin ever saves themselves out of the app.
//
//    It is a break-glass list, not the normal way to give people access: everyone else
//    is managed in /apps/access-admin/ in the browser, with no deploy. Keep it to one or
//    two people, and note that changing it means a commit and a deploy.
//
//    An address here may sign in even if its domain is missing from ALLOWED_DOMAINS, so
//    a typo in the list above cannot lock out the person fixing it.
const ADMIN_EMAILS = [
  "you@example.com",
];

// 3) PUBLIC ORIGIN of this site, used to build the absolute links that MCP tools
//    hand back to a chat ("your app is live at ..."). No trailing slash.
//    Set it to the custom domain once you have one, e.g. https://intra.example.com.
const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://example-intranet.azurestaticapps.net";

// 4) HOW THE ORGANISATION IS NAMED to a language model. Appears in the AI safety
//    preamble (api/AppAI) and in the MCP tool descriptions, so a chat says
//    "hosted on <your> infrastructure" rather than something generic.
const ORG_NAME = "Example Company";

// 5) THE FRONT-DOOR ROLE: the single role every page and every API function checks
//    ("are you let in at all"). Renaming it means renaming it in two places: here and
//    in staticwebapp.config.json (the "/*" and "/api/a/*" rules). Leaving it as
//    "intranet" is fine.
const DOOR_ROLE = "intranet";

const lower = (email) => String(email ?? "").trim().toLowerCase();

// Is this person allowed in at all? The one place the boundary is decided, shared by the
// browser login and the MCP token check so the two can never disagree.
function isAllowedEmail(email) {
  const e = lower(email);
  if (!e.includes("@")) return false;
  if (ADMIN_EMAILS.map(lower).includes(e)) return true;
  return ALLOWED_DOMAINS.includes(e.split("@").pop());
}

function isConfiguredAdmin(email) {
  return ADMIN_EMAILS.map(lower).includes(lower(email));
}

module.exports = {
  ALLOWED_DOMAINS,
  ADMIN_EMAILS,
  SITE_ORIGIN,
  ORG_NAME,
  DOOR_ROLE,
  isAllowedEmail,
  isConfiguredAdmin,
};
