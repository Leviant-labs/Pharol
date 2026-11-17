import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'http';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  const origin = `${proto}://${host}`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Pharol</ShortName>
  <Description>Pharol — Private keyless metasearch engine with direct source aggregation</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <OutputEncoding>UTF-8</OutputEncoding>
  <Url type="text/html" method="get" template="${origin}/?q={searchTerms}" />
  <Url type="application/x-suggestions+json" method="get" template="${origin}/api/suggest?q={searchTerms}&amp;format=opensearch" />
  <Query role="example" searchTerms="nextjs server components" />
</OpenSearchDescription>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/opensearchdescription+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
