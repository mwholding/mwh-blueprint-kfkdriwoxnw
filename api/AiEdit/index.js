// "Rewrite this page with AI": takes the page as it stands plus an instruction and returns the
// revised Markdown, which the browser drops back into the editor for a human to accept or undo.
// It never writes to the store itself — that stays an explicit save by a person.

const { getRoles, getUserEmail } = require("../_shared/roles");
const { canWriteWiki } = require("../_shared/access");
const { chatComplete } = require("../_shared/langdock");

const SYSTEM_PROMPT =
  "You edit Markdown documents for a company intranet. Apply the user's instruction to " +
  "the document and reply with the complete revised document in Markdown. " +
  "Reply with nothing but the revised document — no commentary, no code fences.";

module.exports = async function (context, req) {
  if (!getRoles(req).includes("intranet")) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }
  const email = getUserEmail(req) || "unknown";
  const { kind, content, instruction } = req.body ?? {};
  if (!kind || !content || !instruction) {
    context.res = { status: 400, body: { error: "Expected { kind: 'wiki', content, instruction }" } };
    return;
  }
  if (kind !== "wiki") {
    context.res = { status: 400, body: { error: "kind must be 'wiki'" } };
    return;
  }
  // Rewriting a page is a write, so it needs write permission — an assistant must not be the
  // way around the gate on the app it is editing.
  if (!(await canWriteWiki(email))) {
    context.res = { status: 403, body: { error: "Forbidden" } };
    return;
  }

  try {
    const revised = await chatComplete({
      system: SYSTEM_PROMPT,
      user: `Instruction: ${instruction}\n\n---\nDocument:\n${content}`,
    });
    context.log(`AI-EDIT ${email} kind=${kind}`);
    context.res = { body: { content: revised } };
  } catch (err) {
    context.res = { status: 502, body: { error: err.message } };
  }
};
