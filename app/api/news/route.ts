import { NextRequest, NextResponse } from 'next/server';
import { searchNews } from '@/lib/news-service';
import { requestProviderContext } from '@/lib/provider-credentials';
import type { NewsAccessFilter, SearchRegion, TimeRange } from '@/lib/search-types';

const VALID_TIME_RANGES = new Set<TimeRange>(['all', 'day', 'week', 'month', 'year']);

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const rawTime = params.get('timeRange') as TimeRange | null;
  const timeRange: TimeRange = rawTime && VALID_TIME_RANGES.has(rawTime) ? rawTime : 'all';
  const rawPage = Number(params.get('page') || '1');
  const data = await searchNews({
    query: params.get('q'),
    topic: params.get('topic'),
    access: (params.get('access') as NewsAccessFilter) || 'all',
    region: (params.get('region') as SearchRegion) || 'auto',
    timeRange,
    page: Number.isFinite(rawPage) ? rawPage : 1,
    enginesParam: params.get('engines'),
    signal: req.signal,
    acceptLanguage: params.get('lang') || req.headers.get('accept-language') || undefined,
    ...requestProviderContext(req),
  });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
}
