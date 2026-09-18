import type { NextRequest } from 'next/server';
import { config } from '@/lib/env';
import { badRequest, invalid, jsonError, jsonOk, requireCsrf } from '@/lib/api';
import { requireAuth } from '@/lib/auth/context';
import { fetchProductData, ProductSourceError } from '@/lib/product-source';

export async function POST(request: NextRequest) {
  try {
    await requireAuth(request);
    const cookieCsrf = request.cookies.get(config.csrfCookieName)?.value;
    requireCsrf(cookieCsrf, request.headers.get('x-csrf-token') ?? undefined);

    const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
    if (!body) return jsonError(badRequest('invalid JSON body'));
    if (typeof body.url !== 'string' || body.url.trim() === '') {
      return jsonError(invalid('url is required', 'E-PROD-001'));
    }

    const result = await fetchProductData(body.url.trim());
    return jsonOk({
      product: {
        title: result.title,
        price: result.price,
        bullets: result.bullets,
        suggestedBrief: result.suggestedBrief,
        images: result.images,
      },
    });
  } catch (error) {
    return jsonError(error instanceof ProductSourceError ? error : new ProductSourceError(error instanceof Error ? error.message : 'product extraction failed'));
  }
}