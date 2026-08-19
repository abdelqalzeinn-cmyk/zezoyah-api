/**
 * storage/index.js — Storage abstraction layer
 *
 * Provides getImageStream(filename) with two implementations:
 *   - local: reads from a local disk path (IMAGE_LOCAL_PATH)
 *   - s3:    reads from an S3-compatible bucket (S3_BUCKET, S3_ENDPOINT for R2)
 *
 * Selected by env var IMAGE_STORAGE_DRIVER=local|s3
 */
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const DRIVER = (process.env.IMAGE_STORAGE_DRIVER || 'local').toLowerCase();

let s3Client = null;
let s3Bucket = null;
let s3Initialized = false;

async function initS3() {
  if (s3Initialized) return;
  s3Initialized = true;
  if (DRIVER !== 's3') return;
  const { S3Client } = require('@aws-sdk/client-s3');
  s3Bucket = process.env.S3_BUCKET;
  if (!s3Bucket) throw new Error('S3_BUCKET env var is required when IMAGE_STORAGE_DRIVER=s3');
  s3Client = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: !!process.env.S3_ENDPOINT, // needed for R2 / MinIO
  });
}

/**
 * Get a readable stream + content-type for an image filename.
 * @param {string} filename - e.g. "img_0001.jpg"
 * @returns {Promise<{stream: Readable, contentType: string, contentLength: number}>}
 */
async function getImageStream(filename) {
  if (DRIVER === 'local') {
    return getLocalImage(filename);
  } else if (DRIVER === 's3') {
    return getS3Image(filename);
  }
  throw new Error(`Unknown IMAGE_STORAGE_DRIVER: ${DRIVER}`);
}

function getLocalImage(filename) {
  const localPath = process.env.IMAGE_LOCAL_PATH || path.join(__dirname, '..', 'uploads');
  const fullPath = path.join(localPath, filename);
  if (!fs.existsSync(fullPath)) {
    const err = new Error('Image not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const stat = fs.statSync(fullPath);
  const stream = fs.createReadStream(fullPath);
  return {
    stream,
    contentType: guessContentType(filename),
    contentLength: stat.size,
  };
}

async function getS3Image(filename) {
  await initS3();
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const command = new GetObjectCommand({
    Bucket: s3Bucket,
    Key: filename,
  });
  const response = await s3Client.send(command);
  return {
    stream: response.Body,
    contentType: response.ContentType || guessContentType(filename),
    contentLength: response.ContentLength || 0,
  };
}

function guessContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

module.exports = { getImageStream, guessContentType, DRIVER };
