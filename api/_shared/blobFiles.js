// Files in Blob Storage: the bytes of the user apps and their data, and any files an intranet
// app stores (PDF, Excel, images). Same Storage account as jsonStore.js (connection string
// APP_DATA_STORAGE_CONNECTION_STRING), its own container so JSON documents and files do not
// mix. The container is created on first use — nothing to set up in the portal.

const { BlobServiceClient, BlobSASPermissions } = require("@azure/storage-blob");

const CONTAINER = "intranet-files";

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

async function deleteBlob(blobPath) {
  const container = await getContainerClient();
  await container.getBlockBlobClient(blobPath).deleteIfExists();
}

// The caller chooses the path; keep one prefix per app ("user-app/…", "<your-app>/…").
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

// A download link valid for a few minutes, for handing a file to a browser without proxying it.
// Check the read permission for the record the file belongs to before handing one out.
async function getReadUrl(blobPath, minutesValid = 15) {
  const container = await getContainerClient();
  const blob = container.getBlockBlobClient(blobPath);
  return blob.generateSasUrl({
    permissions: BlobSASPermissions.parse("r"),
    expiresOn: new Date(Date.now() + minutesValid * 60 * 1000),
  });
}

module.exports = {
  getReadUrl,
  deleteBlob,
  putBlob,
  readBlob,
  listBlobPaths,
};
