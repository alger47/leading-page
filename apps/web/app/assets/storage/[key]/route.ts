import { assetStorage } from '@/lib/storage';
import type { NextRequest } from 'next/server';

/**
 * Serves locally-stored assets (ASSET_STORAGE_DRIVER=local) at their public
 * URL, matching what `assetStorage.resolveUrl` advertises. S3 deployments use
 * the presigned URL returned by resolveUrl instead and never hit this route.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { key: string } },
) {
  let key: string;
  try {
    key = decodeURIComponent(params.key);
  } catch {
    key = params.key;
  }
  try {
    const object = await assetStorage.get(key);
    if (!object) {
      return new Response('not found', { status: 404 });
    }
    return new Response(object.body as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': object.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'storage error';
    return new Response(message, { status: 400 });
  }
}