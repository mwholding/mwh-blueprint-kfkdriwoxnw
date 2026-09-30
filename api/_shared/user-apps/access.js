// Who may open a user app. Deliberately separate from access management: every allowed person
// holds SIGNED_IN_ROLE (members and app-only guests alike), and the app's own access list —
// maintained by its owner — decides the rest. Not a member of the intranet? A user app shared
// with you still opens.
//
// An app the caller may not open answers 404, not 403, so private app names cannot be probed.

const { getRoles, getUserEmail } = require("../roles");
const { SIGNED_IN_ROLE } = require("../config");
const store = require("./store");

function isSignedIn(req) {
  return !!getUserEmail(req) && getRoles(req).includes(SIGNED_IN_ROLE);
}

function canUseUserApp(req, app) {
  return !!app && isSignedIn(req) && store.canAccess(app, getUserEmail(req));
}

module.exports = { isSignedIn, canUseUserApp };
