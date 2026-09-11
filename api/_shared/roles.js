// Shared between all API functions that need to know who is calling and with which roles.
// See CLAUDE.md "Security rules" — every function checks roles itself, route rules alone
// are not enough because all functions share one origin.

function getPrincipal(req) {
  const h = req.headers["x-ms-client-principal"];
  if (!h) return null;
  try {
    return JSON.parse(Buffer.from(h, "base64").toString("utf8"));
  } catch (e) {
    return null;
  }
}

function getRoles(req) {
  return getPrincipal(req)?.userRoles ?? [];
}

function getUserEmail(req) {
  return getPrincipal(req)?.userDetails ?? null;
}

module.exports = { getPrincipal, getRoles, getUserEmail };
