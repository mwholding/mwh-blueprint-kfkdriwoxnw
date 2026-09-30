// The public part of site.config.json for the pages: the name, the tagline, the support
// contact and the Langdock link. Never the domains or the admin addresses, which is why the
// file itself is not served (see the "/site.config.json" route rule).

const { getUserEmail } = require("../_shared/roles");
const { hasEmail, publicSite } = require("../_shared/config");

module.exports = async function (context, req) {
  if (!hasEmail(getUserEmail(req))) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }
  context.res = { headers: { "Cache-Control": "private, max-age=300" }, body: publicSite() };
};
