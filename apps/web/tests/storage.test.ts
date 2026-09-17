/** Asset storage: local driver roundtrips + S3 SigV4 request construction (GAP-6). */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStorage, S3Storage, canonicalPath, presignedGetUrl, signV4Header } from '../lib/storage.js';

const tmpDirs: string[] = [];

async function makeLocal(): Promise<LocalStorage> {
  const dir = await fs.mkdtemp(path.join(process.env.TEMP ?? '/tmp', 'landing-ai-assets-'));
  tmpDirs.push(dir);
  return new LocalStorage(dir);
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const s3 = () =>
  new S3Storage(
    {
      bucket: 'my-bucket',
      region: 'us-east-1',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      endpoint: 'https://storage.example.test',
    },
    async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
    () => new Date('2026-09-16T12:00:00Z'),
  );

describe('safe keys', () => {
  it('rejects traversal and empty segments', async () => {
    const storage = await makeLocal();
    await expect(storage.put('../evil', Buffer.from('x'), 'text/plain')).rejects.toThrow(/unsafe/);
    await expect(storage.get('a/../b')).rejects.toThrow(/unsafe/);
    await expect(storage.get('/abs')).rejects.toThrow(/unsafe/);
    await expect(storage.get('')).rejects.toThrow(/empty|unsafe/);
  });
});

describe('LocalStorage', () => {
  it('round-trips an object and reports its content type', async () => {
    const storage = await makeLocal();
    await storage.put('pages/hero.svg', Buffer.from('<svg/>'), 'image/svg+xml');
    const stored = await storage.get('pages/hero.svg');
    expect(stored?.body.toString()).toBe('<svg/>');
    expect(stored?.contentType).toBe('image/svg+xml');
  });

  it('returns null for missing keys and tolerates double delete', async () => {
    const storage = await makeLocal();
    expect(await storage.get('missing')).toBeNull();
    await storage.put('x', Buffer.from('1'), 'text/plain');
    await storage.delete('x');
    expect(await storage.get('x')).toBeNull();
    await expect(storage.delete('x')).resolves.toBeUndefined();
  });

  it('advertises the local serve URL with encoded key', async () => {
    const storage = await makeLocal();
    expect(storage.resolveUrl('a b/icon.png')).toBe('/assets/storage/a%20b%2Ficon.png');
  });
});

describe('canonicalPath / SigV4 header signing', () => {
  it('encodes spaces per segment, preserving slashes', () => {
    expect(canonicalPath('a b/c')).toBe('/a%20b/c');
    expect(canonicalPath('')).toBe('/');
  });

  it('produces a well-formed AWS4-HMAC-SHA256 authorization header', () => {
    const signed = signV4Header({
      method: 'GET',
      host: 'my-bucket.s3.us-east-1.amazonaws.com',
      canonicalUri: '/key',
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      service: 's3',
      date: new Date('2026-09-16T12:00:00Z'),
      extraHeaders: { 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    });
    expect(signed.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\//);
    expect(signed.headers.authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date,');
    expect(signed.headers.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
  });
});

describe('S3Storage HTTP construction', () => {
  it('puts with a signed, payload-hashed header', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit = {};
    const storage = new S3Storage(
      {
        bucket: 'my-bucket',
        region: 'us-east-1',
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
        endpoint: 'https://storage.example.test',
      },
      async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init ?? {};
        return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
      },
      () => new Date('2026-09-16T12:00:00Z'),
    );

    const body = Buffer.from('payload');
    await storage.put('a b/key.png', body, 'image/png');

    expect(capturedUrl).toBe('https://storage.example.test/my-bucket/a%20b/key.png');
    const headers = capturedInit.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    expect(headers.authorization).toContain('Signature=');
    const expected = createHash('sha256').update(body).digest('hex');
    expect(headers['x-amz-content-sha256']).toBe(expected);
  });

  it('gets and surfaces the object content type', async () => {
    const storage = new S3Storage(
      {
        bucket: 'my-bucket',
        region: 'us-east-1',
        accessKeyId: 'A',
        secretAccessKey: 'S',
        endpoint: 'https://storage.example.test',
      },
      async () =>
        new Response('svgdata', {
          status: 200,
          headers: { 'content-type': 'image/svg+xml' },
        }),
      () => new Date('2026-09-16T12:00:00Z'),
    );
    const stored = await storage.get('icon.svg');
    expect(stored?.body.toString()).toBe('svgdata');
    expect(stored?.contentType).toBe('image/svg+xml');
  });

  it('returns null on 404', async () => {
    const storage = new S3Storage(
      { bucket: 'b', region: 'us-east-1', accessKeyId: 'A', secretAccessKey: 'S', endpoint: 'https://e' },
      async () => new Response('no', { status: 404 }),
      () => new Date(),
    );
    expect(await storage.get('missing')).toBeNull();
  });

  it('builds a deterministic presigned GET URL', () => {
    const url = presignedGetUrl({
      host: 'my-bucket.s3.us-east-1.amazonaws.com',
      canonicalUri: '/logo.png',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      date: new Date('2026-09-16T12:00:00Z'),
      expiresSeconds: 900,
    });
    const params = new URL(url);
    expect(params.host).toBe('my-bucket.s3.us-east-1.amazonaws.com');
    expect(params.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(params.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(params.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(params.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('resolveUrl returns a presigned URL with the configured TTL', () => {
    const url = s3().resolveUrl('logo.png');
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Expires=900');
  });
});