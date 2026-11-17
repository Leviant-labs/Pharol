import { NextRequest } from 'next/server';
import { runMetasearch } from '@/lib/server-search';
import { SearchCategory, SearchRegion, TimeRange } from '@/lib/search-types';
import { requestProviders } from '@/lib/provider-credentials';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawQuery = searchParams.get('q')?.trim() || '';
  const category = (searchParams.get('category') as SearchCategory) || 'all';
  const enginesParam = searchParams.get('engines');
  const page = Number(searchParams.get('page') || '1');
  const timeRange = (searchParams.get('timeRange') as TimeRange) || 'all';
  const region = (searchParams.get('region') as SearchRegion) || 'auto';
  const acceptLanguage = searchParams.get('lang') || req.headers.get('accept-language') || undefined;
  const userConfig = requestProviders(req);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const sendEvent = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      try {
        const finalResponse = await runMetasearch({
          rawQuery,
          category,
          enginesParam,
          page: Number.isFinite(page) ? page : 1,
          timeRange,
          region,
          acceptLanguage,
          userConfig,
          onBatch: (partial) => {
            sendEvent('batch', partial);
          },
        });
        sendEvent('done', finalResponse);
      } catch (err) {
        sendEvent('error', {
          message: err instanceof Error ? err.message : 'Metasearch stream error',
        });
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-store, no-transform',
      Connection: 'keep-alive',
    },
  });
}
