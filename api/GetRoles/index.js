const { getRolesForEmail } = require("../_shared/access");

module.exports = async function (context, req) {
  const email = (req.body?.userDetails ?? "").toLowerCase();

  const roles = await getRolesForEmail(email);

  context.log(`LOGIN ${email} roles=${JSON.stringify(roles)}`);
  context.res = { body: { roles } };
};
