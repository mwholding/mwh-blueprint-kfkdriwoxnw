// Conflict-safe writes on top of jsonStore.js, so every store follows the same rule: read with
// the ETag, write only if the blob is unchanged, and retry or report when someone else wrote
// first. Never write a shared JSON blob blindly — two people saving at once would silently
// lose one of the changes.
//
// Two helpers, for two situations:
//   mutateJson(blob, change)       a short read-modify-write inside one request. Retries on
//                                  its own when it loses a race. The usual choice.
//   loadTracked / saveTracked      a document loaded at the start of a longer request and saved
//                                  at the end. A lost race becomes a 409 "reload and try again".
//
// jsonStore is resolved on every call (not captured at load time), so a test that swaps the
// jsonStore module exercises these helpers unchanged.

const store = () => require("./jsonStore");

// True for the errors a conditional write raises when another request wrote first: 412 for a
// changed ETag, 409 when ifNoneMatch "*" meets a blob that now exists.
function isConflict(err) {
  const status = err?.statusCode || err?.response?.status;
  return status === 412 || status === 409;
}

// `change(data)` gets the stored document (null when the blob is missing) and returns the
// document to write, or undefined to write nothing. It may run more than once, so it must
// only compute; side effects (audit lines, deleting files) belong after this returns.
// Resolves to { data, written }.
async function mutateJson(blobName, change, { retries = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    const { data, etag } = await store().readJsonWithEtag(blobName);
    const next = await change(data);
    if (next === undefined) return { data, written: false };
    try {
      await store().writeJson(blobName, next, etag ? { ifMatch: etag } : { ifNoneMatch: "*" });
      return { data: next, written: true };
    } catch (err) {
      if (!isConflict(err) || attempt >= retries) throw err;
    }
  }
}

// The ETag rides on the loaded document as a symbol, so it never ends up in the JSON.
const ETAG = Symbol("etag");

async function loadTracked(blobName) {
  const { data, etag } = await store().readJsonWithEtag(blobName);
  if (data) data[ETAG] = etag;
  return data;
}

// Throws { status: 409, error } when someone else saved since loadTracked — the endpoint passes
// that straight to the browser, which asks the person to reload.
async function saveTracked(blobName, doc, message = "Someone else changed this at the same time. Reload and try again.") {
  try {
    doc[ETAG] = await store().writeJson(blobName, doc, doc[ETAG] ? { ifMatch: doc[ETAG] } : { ifNoneMatch: "*" });
  } catch (err) {
    if (isConflict(err)) throw Object.assign(new Error(message), { status: 409, error: message, conflict: true });
    throw err;
  }
}

module.exports = { isConflict, mutateJson, loadTracked, saveTracked };
