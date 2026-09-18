import type { NextRequest } from 'next/server';
import { config } from '@/lib/env';
import { badRequest, invalid, jsonError, jsonOk, requireCsrf } from '@/lib/api';
import { buildGenerationService } from '@/lib/generation-service';
import { requireAuth } from '@/lib/auth/context';
import { fetchProductData, ProductSourceError } from '@/lib/product-source';
import { isLocale, isTone, validateBriefInput } from '@/lib/validation';

export async function POST(request: NextRequest) {
  try {
    const { owner } = await requireAuth(request);
    const cookieCsrf = request.cookies.get(config.csrfCookieName)?.value;
    requireCsrf(cookieCsrf, request.headers.get('x-csrf-token') ?? undefined);

    const body = (await request.json().catch(() => null)) as {
      projectId?: unknown;
      pageId?: unknown;
      brief?: unknown;
      locale?: unknown;
      tone?: unknown;
      generateImages?: unknown;
      productUrl?: unknown;
    } | null;
    if (!body) return jsonError(badRequest('invalid JSON body'));

    if (typeof body.projectId !== 'string' || body.projectId === '') return jsonError(invalid('projectId is required'));
    if (typeof body.pageId !== 'string' || body.pageId === '') return jsonError(invalid('pageId is required'));

    const briefError = validateBriefInput(body.brief);
    if (briefError) return jsonError(invalid(briefError, 'E-VAL-BRIEF'));
    if (!isLocale(body.locale)) return jsonError(invalid('locale must be one of: ar, fr, en', 'E-VAL-BRIEF'));
    if (!isTone(body.tone)) return jsonError(invalid('tone is not in the supported list', 'E-VAL-BRIEF'));

    // Phase 16 part 2: product-link generation. The brief may have been
    // auto-filled from the product page, but the rasters are ALWAYS re-derived
    // here server-side — never trusted from the client.
    let suppliedImages: Array<{ ref: string; mime: string; data_b64: string }> | undefined;
    if (body.productUrl !== undefined) {
      if (typeof body.productUrl !== 'string' || body.productUrl.trim() === '') {
        return jsonError(invalid('productUrl is invalid', 'E-PROD-001'));
      }
      try {
        const product = await fetchProductData(body.productUrl.trim());
        suppliedImages = product.supplied;
      } catch (error) {
        return jsonError(error instanceof ProductSourceError ? error : new ProductSourceError('product fetch failed'));
      }
    }

    const clientKey = request.headers.get('idempotency-key') ?? undefined;
    const service = buildGenerationService();
    const result = await service.start({
      owner,
      projectId: body.projectId,
      pageId: body.pageId,
      brief: body.brief as string,
      locale: body.locale as 'ar' | 'fr' | 'en',
      tone: body.tone as string,
      clientIdempotencyKey: clientKey,
      generateImages: body.generateImages === true,
      suppliedImages,
    });

    return jsonOk({ jobId: result.jobId, status: result.status }, result.created ? 202 : 200);
  } catch (error) {
    return jsonError(error);
  }
}