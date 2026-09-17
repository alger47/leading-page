/**
 * Asset storage abstraction (roadmap GAP-6: S3 assets).
 *
 * Two interchangeable drivers behind one `AssetStorage` contract:
 *   - `local`  — filesystem under ASSET_STORAGE_DIR (default: os tmpdir).
 *                Served read-mostly at /assets/storage/{key} and fully
 *                exercised by unit tests. Zero external dependencies.
 *   - `s3`     — S3 (or S3-compatible, e.g. MinIO via `endpoint`) using
 *                AWS Signature V4 signing built on node:crypto only — no
 *                SDK dependency, works in any Node runtime. `put/get/delete`
 *                are header-signed; `resolveUrl` returns a short-lived
 *                presigned GET URL for direct browser/img consumption.
 *
 * Keys are encoded with AWS-style URI encoding per path segment and are
 * validated against traversal (`..`, leading `/`, empty segments, NUL).
 */

import { createHash, createHmac } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export interface AssetStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** Stable, cacheable public URL when available (presigned for s3). */
  resolveUrl(key: string): string;
}

const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();

/** AWS SigV4 URI encoding: unreserved chars are A-Z a-z 0-9 - _ . ~. */
const awsEncode = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );

export function canonicalPath(key: string): string {
  return '/' + key.split('/').map(awsEncode).join('/');
}

function assertSafeKey(key: string): void {
  if (!key) throw new Error('asset key must not be empty');
  const segments = key.split('/');
  if (segments.some((seg) => seg.length === 0 || seg === '.' || seg === '..'))
    throw new Error(`unsafe asset key: ${JSON.stringify(key)}`);
  if (key.includes('\0')) throw new Error('asset key must not contain NUL');
}

// Phase 14 §12.4: only image content may be stored. Storing user-supplied
// HTML/SVG-with-script under a same-origin path would turn uploads into a
// stored-XSS / hosting-abuse vector (SVG is allowed but rendered inert at the
// visual surface; storage itself never serves active content semantics).
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
]);

function assertAllowedContentType(contentType: string): void {
  const normalized = contentType.trim().toLowerCase();
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(normalized)) {
    throw new Error(
      `content type ${JSON.stringify(contentType)} is not allowed; only ${[...ALLOWED_UPLOAD_MIME_TYPES].join(', ')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Local filesystem driver
// ---------------------------------------------------------------------------

export class LocalStorage implements AssetStorage {
  readonly directory: string;

  constructor(directory: string = os.tmpdir() + path.sep + 'landing-ai-assets') {
    this.directory = path.resolve(directory);
  }

  private resolvePath(key: string): string {
    assertSafeKey(key);
    const resolved = path.resolve(this.directory, ...key.split('/'));
    if (!resolved.startsWith(this.directory + path.sep))
      throw new Error(`asset key escapes storage dir: ${JSON.stringify(key)}`);
    return resolved;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertAllowedContentType(contentType);
    const file = this.resolvePath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
    await fs.writeFile(`${file}.ctype`, contentType);
  }

  async get(key: string): Promise<StoredObject | null> {
    const file = this.resolvePath(key);
    try {
      const [body, contentType] = await Promise.all([
        fs.readFile(file),
        fs.readFile(`${file}.ctype`, 'utf-8'),
      ]);
      return { body, contentType: contentType || 'application/octet-stream' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.resolvePath(key);
    await fs.unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await fs.unlink(`${file}.ctype`).catch(() => undefined);
  }

  resolveUrl(key: string): string {
    assertSafeKey(key);
    return `/assets/storage/${encodeURIComponent(key)}`;
  }
}

// ---------------------------------------------------------------------------
// S3 driver (AWS SigV4, dependency-free)
// ---------------------------------------------------------------------------

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional S3-compatible base URL (MinIO/localstack/testing). */
  endpoint?: string;
  urlTtlSeconds?: number;
}

interface SignedRequest {
  headers: Record<string, string>;
}

const EMPTY_SHA256 = sha256Hex('');
const EMPTY_QUERY = '';

function amzDateFor(date: Date): string {
  return date
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}/, '');
}

export function signV4Header(params: {
  method: string;
  host: string;
  canonicalUri: string;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  date: Date;
  extraHeaders?: Record<string, string>;
}): SignedRequest {
  const { method, host, canonicalUri, payloadHash, accessKeyId, secretAccessKey, region } = params;
  const service = 's3';
  const amzDate = amzDateFor(params.date);
  const dateStamp = amzDate.slice(0, 8);
  const extra = params.extraHeaders ?? {};
  const headers: Record<string, string> = { host, 'x-amz-date': amzDate, ...extra };
  const signedHeaders = Object.keys(headers)
    .sort()
    .map((name) => name.toLowerCase())
    .join(';');
  const canonicalHeaders =
    Object.keys(headers)
      .sort()
      .map((name) => `${name.toLowerCase()}:${String(headers[name]).trim()}\n`)
      .join('') ??
    '';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequest = [
    method,
    canonicalUri,
    EMPTY_QUERY,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const kDate = hmac(Buffer.from(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');
  return {
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-date': amzDate,
      ...extra,
    },
  };
}

export function presignedGetUrl(params: {
  host: string;
  canonicalUri: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  date: Date;
  expiresSeconds: number;
}): string {
  const { host, canonicalUri, accessKeyId, secretAccessKey, region, date } = params;
  const amzDate = amzDateFor(date);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const queryBase = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(params.expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(queryBase)
    .sort()
    .map((name) => `${awsEncode(name)}=${awsEncode(queryBase[name as keyof typeof queryBase])}`)
    .join('&');
  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const kDate = hmac(Buffer.from(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');
  const query = { ...queryBase, 'X-Amz-Signature': signature };
  const queryString = Object.keys(query)
    .sort()
    .map((name) => `${awsEncode(name)}=${awsEncode(query[name as keyof typeof query])}`)
    .join('&');
  return `https://${host}${canonicalUri}?${queryString}`;
}

export class S3Storage implements AssetStorage {
  readonly config: S3Config;

  constructor(
    config: S3Config,
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!config.bucket || !config.accessKeyId || !config.secretAccessKey || !config.region)
      throw new Error('S3Storage requires bucket, region, accessKeyId and secretAccessKey');
    this.config = config;
  }

  private objectUrl(key: string): string {
    assertSafeKey(key);
    if (this.config.endpoint) {
      return `${this.config.endpoint.replace(/\/+$/, '')}/${this.config.bucket}${canonicalPath(key)}`;
    }
    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com${canonicalPath(key)}`;
  }

  private sign(method: string, url: string, body: Buffer | null): SignedRequest {
    const host = new URL(url).host;
    const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;
    return signV4Header({
      method,
      host,
      canonicalUri: new URL(url).pathname,
      payloadHash,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
      service: 's3',
      date: this.now(),
      extraHeaders: { 'x-amz-content-sha256': payloadHash },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertAllowedContentType(contentType);
    const url = this.objectUrl(key);
    const signed = this.sign('PUT', url, body);
    const response = await this.fetcher(url, {
      method: 'PUT',
      headers: { ...signed.headers, 'content-type': contentType },
      body: body as unknown as BodyInit,
    });
    if (!response.ok) throw new Error(`S3 put failed (${response.status}) for ${key}`);
  }

  async get(key: string): Promise<StoredObject | null> {
    const url = this.objectUrl(key);
    const signed = this.sign('GET', url, null);
    const response = await this.fetcher(url, { method: 'GET', headers: signed.headers });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`S3 get failed (${response.status}) for ${key}`);
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    return { body: Buffer.from(await response.arrayBuffer()), contentType };
  }

  async delete(key: string): Promise<void> {
    const url = this.objectUrl(key);
    const signed = this.sign('DELETE', url, null);
    const response = await this.fetcher(url, { method: 'DELETE', headers: signed.headers });
    if (response.status !== 404 && !response.ok)
      throw new Error(`S3 delete failed (${response.status}) for ${key}`);
  }

  resolveUrl(key: string): string {
    const host = new URL(this.objectUrl(key)).host;
    return presignedGetUrl({
      host,
      canonicalUri: canonicalPath(key),
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
      date: this.now(),
      expiresSeconds: this.config.urlTtlSeconds ?? 900,
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAssetStorage(
  env: Record<string, string | undefined> = process.env,
): AssetStorage {
  const driver = env.ASSET_STORAGE_DRIVER ?? 'local';
  if (driver === 'local') {
    const dir = env.ASSET_STORAGE_DIR;
    return dir ? new LocalStorage(dir) : new LocalStorage();
  }
  if (driver === 's3') {
    const missing = [
      ['ASSET_S3_BUCKET', 'bucket'],
      ['ASSET_S3_ACCESS_KEY_ID', 'accessKeyId'],
      ['ASSET_S3_SECRET_ACCESS_KEY', 'secretAccessKey'],
      ['ASSET_S3_REGION', 'region'],
    ].filter(([name]) => !env[name]);
    if (missing.length > 0) {
      throw new Error(
        `ASSET_STORAGE_DRIVER=s3 requires ${missing.map(([name]) => name).join(', ')}`,
      );
    }
    return new S3Storage({
      bucket: env.ASSET_S3_BUCKET as string,
      region: env.ASSET_S3_REGION as string,
      accessKeyId: env.ASSET_S3_ACCESS_KEY_ID as string,
      secretAccessKey: env.ASSET_S3_SECRET_ACCESS_KEY as string,
      endpoint: env.ASSET_S3_ENDPOINT,
      urlTtlSeconds: env.ASSET_S3_URL_TTL_SECONDS
        ? Number.parseInt(env.ASSET_S3_URL_TTL_SECONDS, 10)
        : undefined,
    });
  }
  throw new Error(`unknown ASSET_STORAGE_DRIVER: ${JSON.stringify(driver)}`);
}

export const assetStorage: AssetStorage = createAssetStorage();