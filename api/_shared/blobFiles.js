// File attachments (PDF, Excel, images, ...) for knowledge base pages, and the file bytes of
// the user apps. Chosen over SharePoint so an upload or download can flow straight through an
// MCP tool call (base64 in, a short-lived SAS URL out) with no Graph API or SharePoint site to
// depend on. Same Storage account as jsonStore.js (connection string
// APP_DATA_STORAGE_CONNECTION_STRING), own container so JSON documents and binary files do not
// mix. The container is created on first use — nothing to set up in the portal.

const { BlobServiceClient, BlobSASPermissions } = require("@azure/storage-blob");
const crypto = require("crypto");

const CONTAINER = "intranet-files";
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

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

async function storeAttachment({ kind, pageId, filename, contentType, buffer }) {
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit`);
  }
  const container = await getContainerClient();
  const id = crypto.randomUUID();
  const blobPath = `${kind}/${pageId}/${id}-${filename}`;
  const blob = container.getBlockBlobClient(blobPath);
  await blob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  return { id, filename, contentType, size: buffer.length, blobPath };
}

async function deleteBlob(blobPath) {
  const container = await getContainerClient();
  await container.getBlockBlobClient(blobPath).deleteIfExists();
}

// Generic byte-level helpers, added for the user-app platform (userAppStore.js) but not
// specific to it. Unlike storeAttachment they leave naming entirely to the caller.
async function putBlob(blobPath, buffer, contentType) {
  const container = await getContainerClient();
  const blob = container.getBlockBlobClient(blobPath);
  await blob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
}

async function readBlob(blobPath) {
  const container = await getContainerClient();
  const blob = container.getBlockBlobClient(blobPath);
  if (!(await blob.exists())) return null;
  const [buffer, props] = await Promise.all([blob.downloadToBuffer(), blob.getProperties()]);
  return { buffer, contentType: props.contentType ?? "application/octet-stream" };
}

async function listBlobPaths(prefix) {
  const container = await getContainerClient();
  const items = [];
  for await (const blob of container.listBlobsFlat({ prefix })) {
    items.push({
      path: blob.name,
      size: blob.properties.contentLength ?? 0,
      contentType: blob.properties.contentType ?? "application/octet-stream",
      modifiedAt: blob.properties.lastModified?.toISOString?.() ?? null,
    });
  }
  return items;
}

async function getReadUrl(blobPath, minutesValid = 15) {
  const container = await getContainerClient();
  const blob = container.getBlockBlobClient(blobPath);
  return blob.generateSasUrl({
    permissions: BlobSASPermissions.parse("r"),
    expiresOn: new Date(Date.now() + minutesValid * 60 * 1000),
  });
}

// Only used for the MCP `upload_attachment` tool's sourceUrl option. Restricted to an
// allowlist of hosts (set via app setting MCP_ATTACHMENT_FETCH_HOSTS, comma-separated) to
// avoid turning this into an open server-side URL fetcher (SSRF).
const ALLOWED_FETCH_HOSTS = (process.env.MCP_ATTACHMENT_FETCH_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

async function fetchRemoteFile(url) {
  const parsed = new URL(url);
  if (!ALLOWED_FETCH_HOSTS.includes(parsed.hostname)) {
    throw new Error(`Fetching attachments from host "${parsed.hostname}" is not allowed`);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch attachment from source URL: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit`);
  }
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return { buffer, contentType };
}

module.exports = {
  storeAttachment,
  getReadUrl,
  deleteBlob,
  putBlob,
  readBlob,
  listBlobPaths,
  fetchRemoteFile,
  MAX_ATTACHMENT_BYTES,
};
