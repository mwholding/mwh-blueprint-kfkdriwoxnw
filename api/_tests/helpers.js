// Test helpers: an in-memory Blob store with real ETag behaviour, installed in place of
// _shared/jsonStore.js (and optionally _shared/blobFiles.js), and a fresh load of the module
// under test so no state leaks between tests. No test touches Azure.

const path = require("node:path");

const API_ROOT = path.resolve(__dirname, "..");

// A fixed test configuration (admin you@example.com), whatever the
// organisation has put into the real site.config.json.
process.env.SITE_CONFIG_FILE = path.join(__dirname, "fixtures", "site.config.json");

function memoryStore() {
  const blobs = new Map();
  const audit = [];
  let n = 0;
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  return {
    blobs,
    audit,
    readJson: async (name) => clone(blobs.get(name)?.data ?? null),
    readJsonWithEtag: async (name) =>
      blobs.has(name) ? { data: clone(blobs.get(name).data), etag: blobs.get(name).etag } : { data: null, etag: null },
    writeJson: async (name, data, { ifMatch, ifNoneMatch } = {}) => {
      const cur = blobs.get(name);
      if (ifMatch && (!cur || cur.etag !== ifMatch)) throw Object.assign(new Error("precondition"), { statusCode: 412 });
      if (ifNoneMatch && cur) throw Object.assign(new Error("exists"), { statusCode: 409 });
      const etag = `e${++n}`;
      blobs.set(name, { data: clone(data), etag });
      return etag;
    },
    appendAuditLine: async (name, entry) => void audit.push({ name, ...entry }),
    readAuditLines: async (name) => audit.filter((e) => e.name === name),
  };
}

// A stand-in for blobFiles.js that keeps file bytes in memory.
function memoryFiles() {
  const files = new Map();
  return {
    files,
    putBlob: async (p, buffer, contentType) => void files.set(p, { buffer, contentType }),
    readBlob: async (p) => files.get(p) ?? null,
    deleteBlob: async (p) => void files.delete(p),
    listBlobPaths: async (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ path: k, size: files.get(k).buffer.length })),
    getReadUrl: async () => "https://example.invalid/sas",
  };
}

// Clears every repository module from the require cache, installs the stubs and loads `relative`.
function load(relative, { store = memoryStore(), files } = {}) {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(API_ROOT) && !key.includes(`${path.sep}node_modules${path.sep}`)) delete require.cache[key];
  }
  const stub = (name, exports) => {
    const file = path.resolve(API_ROOT, name);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  stub("_shared/jsonStore.js", store);
  if (files) stub("_shared/blobFiles.js", files);
  return require(path.resolve(API_ROOT, relative));
}

// A request as the SWA platform hands it to a function, for a signed-in person with `roles`.
function request(email, roles, extra = {}) {
  const principal = Buffer.from(JSON.stringify({ userDetails: email, userRoles: roles })).toString("base64");
  return { method: "GET", query: {}, headers: { "x-ms-client-principal": principal }, ...extra };
}

async function invoke(handler, req, bindingData = {}) {
  const context = { res: null, bindingData, log() {} };
  await handler(context, req);
  return context.res;
}

module.exports = { memoryStore, memoryFiles, load, request, invoke };
