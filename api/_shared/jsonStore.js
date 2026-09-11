// Minimal JSON-file-in-Blob-Storage persistence for small, user-edited datasets (the access
// document, a catalog, a register). See CLAUDE.md "Data" for when this pattern is the right one
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

async function readJson(blobName) {
  const container = await getContainerClient();
  const blob = container.getBlockBlobClient(blobName);
  if (!(await blob.exists())) return null;
  const buf = await blob.downloadToBuffer();
  return JSON.parse(buf.toString("utf8"));
}

// Same as readJson, but also hands back the blob's ETag so a caller can later write
// conditionally (writeJson's ifMatch option) instead of blindly overwriting whatever
// another request wrote in between. Returns { data: null, etag: null } for a missing blob.
async function readJsonWithEtag(blobName) {
  const container = await getContainerClient();
  const blob = container.getBlockBlobClient(blobName);
  if (!(await blob.exists())) return { data: null, etag: null };
  const buf = await blob.downloadToBuffer();
  const props = await blob.getProperties();
  return { data: JSON.parse(buf.toString("utf8")), etag: props.etag };
}

async function writeJson(blobName, data, { ifMatch } = {}) {
  const container = await getContainerClient();
  const blob = container.getBlockBlobClient(blobName);
  const body = JSON.stringify(data, null, 2);
  const options = {
    blobHTTPHeaders: { blobContentType: "application/json" },
  };
  if (ifMatch) {
    // Conditional write: fails with a RestError (statusCode 412) if the blob changed since
    // it was read, instead of silently clobbering a concurrent writer's change.
    options.conditions = { ifMatch };
  } else {
    options.overwrite = true;
  }
  await blob.upload(body, Buffer.byteLength(body), options);
}

async function appendAuditLine(blobName, entry) {
  const container = await getContainerClient();
  const blob = container.getAppendBlobClient(blobName);
  await blob.createIfNotExists();
  const line = JSON.stringify(entry) + "\n";
  await blob.appendBlock(line, Buffer.byteLength(line));
}

async function readAuditLines(blobName) {
  const container = await getContainerClient();
  const blob = container.getAppendBlobClient(blobName);
  if (!(await blob.exists())) return [];
  const buf = await blob.downloadToBuffer();
  return buf
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

module.exports = { readJson, readJsonWithEtag, writeJson, appendAuditLine, readAuditLines };
