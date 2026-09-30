// Reads site.config.json, the one file an organisation edits (see README.md "Configuration").
// Nothing else in api/ carries an organisation-specific value.
//
// Where the file is: the deploy workflow copies it from the repository root into api/, because
// Azure deploys only the api/ folder to the functions. Locally and in the tests there is no
// copy, so the root file is read instead.

const fs = require("fs");
const path = require("path");

function readConfig() {
  // SITE_CONFIG_FILE points somewhere else; the tests use it for a fixed test configuration.
  const candidates = process.env.SITE_CONFIG_FILE
    ? [process.env.SITE_CONFIG_FILE]
    : [path.join(__dirname, "..", "site.config.json"), path.join(__dirname, "..", "..", "site.config.json")];
  for (const file of candidates) {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  throw new Error("site.config.json not found (expected in api/ after deploy, or at the repository root)");
}

const config = readConfig();
const lower = (email) => String(email ?? "").trim().toLowerCase();
const list = (value) => (Array.isArray(value) ? value.map(lower).filter(Boolean) : []);

// Who may sign in at all is decided by the Entra app registration, not here: whoever Entra
// lets through is signed in. Restrict it there (single tenant, or "Assignment required").
// The break-glass admins: they hold every permission whatever access.json says.
const ADMIN_EMAILS = list(config.adminEmails);
// The intranet's name; the AI is also told it ("hosted on <name>'s own infrastructure").
const NAME = config.name || "Intranet";
const LANGDOCK = { url: "https://app.langdock.com/", integrationName: "Intranet", model: "gpt-5.6-terra", ...(config.langdock || {}) };

// The two built-in roles (not configurable; see AGENTS.md "Access"):
//   DOOR_ROLE       members of the intranet: the home page, search, the Langdock connection
//   SIGNED_IN_ROLE  everyone allowed, members and app-only guests: /assets/* and /api/*
const DOOR_ROLE = "intranet";
const SIGNED_IN_ROLE = "signed-in";

// A verified sign-in: the principal or token carries an email address. Everything beyond that
// is access management's job.
function hasEmail(email) {
  return lower(email).includes("@");
}

function isConfiguredAdmin(email) {
  return ADMIN_EMAILS.includes(lower(email));
}

// What the pages may know (api/Site): the name, the tagline and the Langdock link, never the
// domains or the admins.
function publicSite() {
  return {
    name: NAME,
    tagline: config.tagline || "",
    langdock: { url: LANGDOCK.url, integrationName: LANGDOCK.integrationName },
  };
}

module.exports = {
  ADMIN_EMAILS,
  NAME,
  LANGDOCK,
  DOOR_ROLE,
  SIGNED_IN_ROLE,
  hasEmail,
  isConfiguredAdmin,
  publicSite,
};
