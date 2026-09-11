// Emit one route rule per app folder into staticwebapp.config.json, so that every /apps/<name>/
// path is guarded by its own role `<name>`. Runs in CI on every push (see the workflow step
// "Generate per-app route rules") and needs no credentials — it reads the repo, not Blob Storage.
//
//   node misc/generate-app-routes.js           # rewrite the file
//   node misc/generate-app-routes.js --check   # exit 1 if it would change anything
//
// Why this shape: route rules are deployed edge config and can't be written at runtime, but the
// *roles* that satisfy them come from access.json in Blob Storage at login. So the rule for an
// app never has to change — only who holds its role does:
//
//   registry says gated: false -> api/_shared/access.js hands role <name> to every
//                                 allowed-domain user, reproducing the "/*" catch-all
//   registry says gated: true  -> role <name> comes only from a group permission
//
// That makes flipping an app between open and restricted a pure Blob Storage change: it takes
// effect at the user's next login, with no deploy and nothing to remember. Adding a *new* app
// folder brings its rule along in the same deploy that creates the folder.
//
// Rules for paths this script doesn't own (/api/GetRoles, /api/Mcp, /api/a/*, anything added by
// hand for a non-/apps/ path) are preserved verbatim, in order. The catch-all stays last.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, ".."); // repo root — this script lives in misc/
const APPS_DIR = path.join(ROOT, "apps");
const CONFIG = path.join(ROOT, "staticwebapp.config.json");
const CATCH_ALL = "/*";

// An app is a folder under apps/ with an index.html — apps.json and stray files are not apps.
function appFolders() {
  return fs
    .readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(APPS_DIR, e.name, "index.html")))
    .map((e) => e.name)
    .sort();
}

const routeFor = (name) => `/apps/${name}/*`;

function buildRoutes(existing, apps) {
  const owned = new Set(apps.map(routeFor));

  const preserved = existing.filter((r) => r.route !== CATCH_ALL && !owned.has(r.route));
  const catchAll = existing.find((r) => r.route === CATCH_ALL) || {
    route: CATCH_ALL,
    allowedRoles: ["intranet"],
  };

  const generated = apps
    .slice()
    // Longest path first so a more specific rule never sits below a broader one.
    .sort((a, b) => routeFor(b).length - routeFor(a).length || a.localeCompare(b))
    .map((name) => ({ route: routeFor(name), allowedRoles: [name] }));

  return [...preserved, ...generated, catchAll];
}

function main() {
  const check = process.argv.includes("--check");
  const apps = appFolders();
  if (!apps.length) {
    console.error("No app folders found under apps/ — refusing to rewrite the routes.");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  const before = JSON.stringify(config.routes, null, 2);
  const next = buildRoutes(config.routes || [], apps);

  // CLAUDE.md: /api/GetRoles must stay anonymous or every login loops.
  const getRoles = next.find((r) => r.route === "/api/GetRoles");
  if (!getRoles || !(getRoles.allowedRoles || []).includes("anonymous")) {
    console.error("Refusing to write: /api/GetRoles is missing or not anonymous.");
    process.exit(1);
  }
  if (next[next.length - 1].route !== CATCH_ALL) {
    console.error("Refusing to write: the catch-all is not last.");
    process.exit(1);
  }

  config.routes = next;
  const after = JSON.stringify(config.routes, null, 2);
  const body = JSON.stringify(config, null, 2) + "\n";
  JSON.parse(body); // invalid JSON makes SWA ignore the file entirely and serve unprotected

  if (before === after) {
    console.log(`Routes already cover all ${apps.length} apps — nothing to do.`);
    return;
  }

  if (check) {
    console.error("--check: routes are out of date.\nbefore:\n" + before + "\nafter:\n" + after);
    process.exit(1);
  }

  fs.writeFileSync(CONFIG, body);
  console.log(`Wrote ${apps.length} app rules to staticwebapp.config.json:\n  ${apps.join("\n  ")}`);
}

module.exports = { buildRoutes, appFolders, routeFor };

if (require.main === module) main();
