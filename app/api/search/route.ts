import { NextRequest, NextResponse } from 'next/server';
import { runMetasearch } from '@/lib/server-search';
import { SearchCategory, SearchRegion, TimeRange } from '@/lib/search-types';
import { requestProviderContext } from '@/lib/provider-credentials';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawQuery = searchParams.get('q')?.trim() || '';
  const category = (searchParams.get('category') as SearchCategory) || 'all';
  const enginesParam = searchParams.get('engines');
  const page = Number(searchParams.get('page') || '1');
  const timeRange = (searchParams.get('timeRange') as TimeRange) || 'all';
  const region = (searchParams.get('region') as SearchRegion) || 'auto';
  const acceptLanguage = searchParams.get('lang') || req.headers.get('accept-language') || undefined;

  const result = await runMetasearch({
    rawQuery,
    category,
    enginesParam,
    page: Number.isFinite(page) ? page : 1,
    timeRange,
    region,
    acceptLanguage,
    ...requestProviderContext(req),
  });

  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
}
