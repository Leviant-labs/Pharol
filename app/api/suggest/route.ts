import { NextRequest, NextResponse } from 'next/server';
import { resolveRegionProfile } from '@/lib/search-engine';
import { SearchRegion } from '@/lib/search-types';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  const isOpenSearch = searchParams.get('format') === 'opensearch';
  const regionParam = (searchParams.get('region') as SearchRegion) || 'auto';
  const langParam = searchParams.get('lang') || req.headers.get('accept-language') || undefined;

  if (!q || q.length < 2) {
    return NextResponse.json(isOpenSearch ? [q || '', []] : { suggestions: [] });
  }

  const regionProfile = resolveRegionProfile(regionParam, q, langParam);

  try {
    // Query DuckDuckGo keyless autocomplete with a 2-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const ddgUrl = `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&kl=${encodeURIComponent(regionProfile.ddgKl)}&type=list`;
    const res = await fetch(ddgUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': `${regionProfile.bingLang},${regionProfile.lang};q=0.9`,
      },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      // data format is [query, [suggestions...]]
      if (Array.isArray(data) && Array.isArray(data[1])) {
        const list = data[1].slice(0, 7) as string[];
        return NextResponse.json(isOpenSearch ? [q, list] : { suggestions: list });
      }
    }
  } catch {
    // fallback to regional wikipedia opensearch
    try {
      const wikiUrl = `https://${regionProfile.wikiLang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=6&namespace=0&format=json`;
      const wikiRes = await fetch(wikiUrl, {
        headers: { 'User-Agent': 'Pharol/1.0 (suggest)' },
        signal: AbortSignal.timeout(2000),
      });
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        if (Array.isArray(wikiData) && Array.isArray(wikiData[1])) {
          const list = wikiData[1].slice(0, 6) as string[];
          return NextResponse.json(isOpenSearch ? [q, list] : { suggestions: list });
        }
      }
    } catch {
      // return empty if network offline
    }
  }

  return NextResponse.json(isOpenSearch ? [q, []] : { suggestions: [] });
}
