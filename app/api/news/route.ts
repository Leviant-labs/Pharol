import { NextRequest, NextResponse } from 'next/server';
import { searchNews } from '@/lib/news-service';
import { requestProviderContext } from '@/lib/provider-credentials';
import type { NewsAccessFilter, SearchRegion } from '@/lib/search-types';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const data = await searchNews({
    query: params.get('q'),
    topic: params.get('topic'),
    access: (params.get('access') as NewsAccessFilter) || 'all',
    region: (params.get('region') as SearchRegion) || 'auto',
    acceptLanguage: params.get('lang') || req.headers.get('accept-language') || undefined,
    ...requestProviderContext(req),
  });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}
