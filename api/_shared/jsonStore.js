// Minimal JSON-file-in-Blob-Storage persistence for small, user-edited datasets (the access
// document, a catalog, a register). See AGENTS.md "Data" for when this pattern is the right one
// and when a dataset belongs in SharePoint or a database instead.
//
// Requires the app setting APP_DATA_STORAGE_CONNECTION_STRING (an Azure Storage account
// connection string, set in the Static Web App's Function App configuration — never in
// the repo). One container ("app-data") holds one JSON blob per dataset plus an
// append-only .jsonl audit log blob per dataset.

const { BlobServiceClient } = require("@azure/storage-blob");

const CONTAINER = "app-data";

let containerClientPromise = null;
function getContainerClient() {
  if (!containerClientPromise) {
    const conn = process.env.APP_DATA_STORAGE_CONNECTION_STRING;
    if (!conn) throw new Error("APP_DATA_STORAGE_CONNECTION_STRING is not set");
    const service = BlobServiceClient.fromConnectionString(conn);
    const container = service.getContainerClient(CONTAINER);
    containerClientPromise = container.createIfNotExists().then(() => container);
  }
  return containerClientPromise;
}

// Downloads a blob and its ETag in one request (null when it does not exist), so the ETag
// always belongs to exactly the bytes that were read.
async function download(blob) {
  try {
    const res = await blob.download();
    const chunks = [];
    for await (const chunk of res.readableStreamBody) chunks.push(chunk);
    return { buf: Buffer.concat(chunks), etag: res.etag };
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function readJson(blobName) {
  return (await readJsonWithEtag(blobName)).data;
}

// Same as readJson, but also hands back the blob's ETag so a caller can later write
// conditionally instead of overwriting whatever another request wrote in between.
// Returns { data: null, etag: null } for a missing blob. Most callers want jsonDoc.js, which
// wraps this in ready-made read-modify-write helpers.
async function readJsonWithEtag(blobName) {
  const container = await getContainerClient();
  const got = await download(container.getBlockBlobClient(blobName));
  if (!got) return { data: null, etag: null };
  return { data: JSON.parse(got.buf.toString("utf8")), etag: got.etag };
}

// Writes the document and returns the new ETag. Conditions:
//   ifMatch: etag     only if the blob is unchanged since it was read (else 412)
//   ifNoneMatch: "*"  only if the blob does not exist yet (else 409/412)
// Without either, the blob is overwritten unconditionally.
async function writeJson(blobName, data, { ifMatch, ifNoneMatch } = {}) {
  const container = await getContainerClient();
  const blob = container.getBlockBlobClient(blobName);
  const body = JSON.stringify(data); // compact: these blobs are read by code, not people
  const options = { blobHTTPHeaders: { blobContentType: "application/json" } };
  if (ifMatch || ifNoneMatch) {
    options.conditions = { ...(ifMatch ? { ifMatch } : {}), ...(ifNoneMatch ? { ifNoneMatch } : {}) };
  }
  const res = await blob.upload(body, Buffer.byteLength(body), options);
  return res.etag;
}

async function appendAuditLine(blobName, entry) {
  const container = await getContainerClient();
  const blob = container.getAppendBlobClient(blobName);
  const line = JSON.stringify(entry) + "\n";
  try {
    await blob.appendBlock(line, Buffer.byteLength(line));
  } catch (err) {
    // First line of a new trail: create the blob, then append. One request in the usual case.
    if (err.statusCode !== 404) throw err;
    await blob.createIfNotExists();
    await blob.appendBlock(line, Buffer.byteLength(line));
  }
}

async function readAuditLines(blobName) {
  const container = await getContainerClient();
  const got = await download(container.getAppendBlobClient(blobName));
  if (!got) return [];
  return got.buf
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

module.exports = { readJson, readJsonWithEtag, writeJson, appendAuditLine, readAuditLines };
