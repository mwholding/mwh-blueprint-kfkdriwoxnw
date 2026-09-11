// Validates Entra ID access tokens presented to /api/Mcp as `Authorization: Bearer <token>`.
// The MCP server is a pure OAuth *resource server* here — Langdock talks to Entra ID's
// /authorize and /token endpoints itself (via its "OAuth 2.0 Manual" integration mode). This
// module only verifies the resulting token and extracts the caller's email; it never issues or
// exchanges tokens itself.
//
// ONE App Registration serves both front doors: the same registration that carries the website
// sign-in (AAD_CLIENT_ID / AAD_CLIENT_SECRET) also exposes the scope Langdock asks for. It is
// the same application and the same people, so a second registration would only be a second
// thing to keep in step. It needs two redirect URIs (the SWA callback and Langdock's) and,
// sensibly, one client secret per consumer so rotating one does not break the other.
//
// Subsidiaries often have more than one Entra tenant (one per country or per legal entity),
// so a token's issuer varies with the caller's home tenant. Langdock is therefore configured
// against the multi-tenant "organizations" endpoint (matching the SWA's own AAD login), and we
// cannot validate against one fixed tenant: instead read the tenant id (`tid`) out of the token
// itself, verify signature/issuer against *that* tenant's JWKS, and then apply isAllowedEmail
// from _shared/config.js — the same boundary GetRoles enforces for the browser login. With a
// single tenant this still works unchanged.
//
// Audience: taken from AAD_CLIENT_ID, the sign-in registration's client id, so there is
// nothing extra to configure. MCP_OAUTH_AUDIENCE overrides it (comma-separated list) for the
// one case that needs it: a separate registration for the MCP integration.

const { createRemoteJWKSet, jwtVerify, decodeJwt } = require("jose");
const { isAllowedEmail } = require("./config");

const jwksByTenant = new Map();
function getJwks(tenantId) {
  if (!jwksByTenant.has(tenantId)) {
    jwksByTenant.set(
      tenantId,
      createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`))
    );
  }
  return jwksByTenant.get(tenantId);
}

// Entra writes `aud` as either the bare client id or the Application ID URI, depending on how
// the registration's App ID URI is written and which token version it issues. Both name the
// same resource, so accept both forms rather than making an admin guess which one to configure
// — guessing wrong fails every call with a bare "Unauthorized".
function allowedAudiences() {
  const raw = process.env.MCP_OAUTH_AUDIENCE || process.env.AAD_CLIENT_ID || "";
  const configured = raw.split(",").map((a) => a.trim()).filter(Boolean);
  if (!configured.length) {
    throw new Error("Neither AAD_CLIENT_ID nor MCP_OAUTH_AUDIENCE is set");
  }
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const out = new Set();
  for (const value of configured) {
    out.add(value);
    if (GUID.test(value)) out.add(`api://${value}`);
    else if (value.startsWith("api://") && GUID.test(value.slice(6))) out.add(value.slice(6));
  }
  return [...out];
}

async function verifyToken(token) {
  const audience = allowedAudiences();

  const decoded = decodeJwt(token);
  const tenantId = decoded.tid;
  if (!tenantId) {
    throw new Error(
      `Token has no tid claim. iss=${decoded.iss ?? "(none)"} aud=${decoded.aud ?? "(none)"} claims=${Object.keys(decoded).join(", ") || "(none)"}`
    );
  }

  // Entra sometimes issues v1.0-format access tokens for custom API scopes even via the v2.0
  // token endpoint (issuer https://sts.windows.net/{tid}/ instead of
  // https://login.microsoftonline.com/{tid}/v2.0), depending on the App Registration's
  // accessTokenAcceptedVersion manifest setting — accept either, the v2.0 discovery JWKS
  // validates both.
  const { payload } = await jwtVerify(token, getJwks(tenantId), {
    issuer: [`https://login.microsoftonline.com/${tenantId}/v2.0`, `https://sts.windows.net/${tenantId}/`],
    audience,
  });

  const email = (payload.preferred_username || payload.email || payload.upn || "").toLowerCase();
  if (!isAllowedEmail(email)) {
    throw new Error(`"${email}" is not allowed to use this intranet (see ALLOWED_DOMAINS in _shared/config.js)`);
  }

  return payload;
}

module.exports = { verifyToken };
