import { NextRequest, NextResponse } from 'next/server';
import { readWebpage, ReaderError } from '@/lib/reader-service';
import { requestProviderContext } from '@/lib/provider-credentials';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  try {
    const content = await readWebpage(req.nextUrl.searchParams.get('url') ?? '', requestProviderContext(req));
    return NextResponse.json(content, { headers });
  } catch (error) {
    if (error instanceof ReaderError && (error.code === 'missing_url' || error.code === 'invalid_url')) {
      return NextResponse.json({ error: error.message }, { status: 400, headers });
    }
    return NextResponse.json({ error: 'Unable to render readable content' }, { status: 500, headers });
  }
}
