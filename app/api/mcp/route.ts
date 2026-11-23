import { NextRequest, NextResponse } from 'next/server';
import { runMetasearch } from '@/lib/server-search';
import { requestProviderContext } from '@/lib/provider-credentials';
import { searchNews } from '@/lib/news-service';
import { readWebpage, ReaderError } from '@/lib/reader-service';
import { runPaperTool, PAPER_TOOL_NAMES } from '@/lib/paper-tools';
import { NewsAccessFilter, parseSearchMode, SearchCategory, SearchRegion, TimeRange } from '@/lib/search-types';
import {
  SEARX_MCP_SERVER_INFO,
  SEARX_MCP_TOOLS,
  buildJsonRpcError,
  buildJsonRpcSuccess,
} from '@/lib/mcp-tools';
import { GET as suggestGET } from '../suggest/route';
import { GET as weatherGET } from '../weather/route';

const CORS_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Origin',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'http';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  const origin = `${proto}://${host}`;

  return NextResponse.json(
    {
      name: SEARX_MCP_SERVER_INFO.name,
      version: SEARX_MCP_SERVER_INFO.version,
      protocol: 'MCP Streamable HTTP (JSON-RPC 2.0 via POST)',
      endpoint: `${origin}/api/mcp`,
      tools: SEARX_MCP_TOOLS.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
      })),
    },
    { headers: CORS_HEADERS }
  );
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      buildJsonRpcError(null, -32700, 'Parse error: invalid JSON'),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const id = body?.id ?? null;
  const method = body?.method;
  const params = body?.params || {};

  if (!method || typeof method !== 'string') {
    return NextResponse.json(
      buildJsonRpcError(id, -32600, 'Invalid Request: missing method'),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (method === 'initialize') {
    return NextResponse.json(
      buildJsonRpcSuccess(id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: SEARX_MCP_SERVER_INFO,
      }),
      { headers: CORS_HEADERS }
    );
  }

  if (method === 'notifications/initialized' || method === 'ping') {
    return NextResponse.json(buildJsonRpcSuccess(id, {}), { headers: CORS_HEADERS });
  }

  if (method === 'tools/list') {
    return NextResponse.json(
      buildJsonRpcSuccess(id, { tools: SEARX_MCP_TOOLS }),
      { headers: CORS_HEADERS }
    );
  }

  if (method === 'tools/call') {
    const toolName: string | undefined = params?.name;
    const args: Record<string, any> = params?.arguments || {};

    try {
      const providerContext = requestProviderContext(req);
      if (toolName && PAPER_TOOL_NAMES.includes(toolName)) {
        const data = await runPaperTool(toolName, args, providerContext.userConfig, providerContext.providerDefaults);
        return NextResponse.json(buildJsonRpcSuccess(id, {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        }), { headers: CORS_HEADERS });
      }
      if (toolName === 'web_search') {
        const query = String(args.query || '').trim();
        if (!query) {
          return NextResponse.json(
            buildJsonRpcError(id, -32602, 'Invalid params: query is required'),
            { status: 400, headers: CORS_HEADERS }
          );
        }
        const category = (args.category as SearchCategory) || 'all';
        const timeRange = (args.timeRange as TimeRange) || 'all';
        const page = typeof args.page === 'number' ? args.page : 1;
        const enginesParam = Array.isArray(args.engines) ? args.engines.join(',') : null;
        const region = (args.region as SearchRegion) || 'auto';
        const acceptLanguage = req.headers.get('accept-language') || undefined;

        const searchData = await runMetasearch({
          rawQuery: query,
          category,
          timeRange,
          enginesParam,
          mode: parseSearchMode(args.mode),
          signal: req.signal,
          page,
          region,
          acceptLanguage,
          ...providerContext,
        });

        return NextResponse.json(
          buildJsonRpcSuccess(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    query: searchData.query,
                    category: searchData.category,
                    totalResults: searchData.totalResults,
                    timeTakenMs: searchData.timeTakenMs,
                    enginesUsed: searchData.enginesUsed,
                    knowledgeBox: searchData.knowledgeBox || null,
                    results: searchData.results.slice(0, 15).map((r) => ({
                      title: r.title,
                      url: r.url,
                      snippet: r.snippet,
                      engine: r.engine,
                      publishedDate: r.publishedDate,
                      score: r.score,
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          }),
          { headers: CORS_HEADERS }
        );
      }

      if (toolName === 'academic_search') {
        const query = String(args.query || '').trim();
        if (!query) {
          return NextResponse.json(
            buildJsonRpcError(id, -32602, 'Invalid params: query is required'),
            { status: 400, headers: CORS_HEADERS }
          );
        }
        const page = typeof args.page === 'number' ? args.page : 1;
        const searchData = await runMetasearch({
          rawQuery: query,
          category: 'science',
          page,
          ...providerContext,
          ignoreBangRouting: true,
        });

        return NextResponse.json(
          buildJsonRpcSuccess(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    query: searchData.query,
                    totalResults: searchData.totalResults,
                    enginesUsed: searchData.enginesUsed,
                    papers: searchData.results.slice(0, 15).map((r) => ({
                      title: r.title,
                      url: r.url,
                      doi: r.doi,
                      pdfUrl: r.pdfUrl,
                      journal: r.journal,
                      publishedDate: r.publishedDate,
                      citations: r.citations,
                      authors: r.authors,
                      snippet: r.snippet,
                      engine: r.engine,
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          }),
          { headers: CORS_HEADERS }
        );
      }

      if (toolName === 'news_search') {
        const data = await searchNews({
          query: args.query ? String(args.query) : undefined,
          topic: args.topic ? String(args.topic) : undefined,
          region: args.region ? String(args.region) as SearchRegion : undefined,
          access: (args.access as NewsAccessFilter) || 'free',
          timeRange: (args.timeRange as TimeRange) || 'all',
          signal: req.signal,
          acceptLanguage: req.headers.get('accept-language') || undefined,
          ...providerContext,
        });

        return NextResponse.json(
          buildJsonRpcSuccess(id, {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          }),
          { headers: CORS_HEADERS }
        );
      }

      if (toolName === 'read_webpage') {
        const targetUrl = String(args.url || '').trim();
        if (!targetUrl) {
          return NextResponse.json(
            buildJsonRpcError(id, -32602, 'Invalid params: url is required'),
            { status: 400, headers: CORS_HEADERS }
          );
        }
        const data = await readWebpage(targetUrl, providerContext);

        return NextResponse.json(
          buildJsonRpcSuccess(id, {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          }),
          { headers: CORS_HEADERS }
        );
      }

      if (toolName === 'suggest_queries') {
        const q = String(args.query || '').trim();
        const internalReq = new NextRequest(
          `http://localhost:3000/api/suggest?q=${encodeURIComponent(q)}`
        );
        const res = await suggestGET(internalReq);
        const data = await res.json();

        return NextResponse.json(
          buildJsonRpcSuccess(id, {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          }),
          { headers: CORS_HEADERS }
        );
      }

      if (toolName === 'get_weather') {
        const city = String(args.city || 'London').trim();
        const internalReq = new NextRequest(
          `http://localhost:3000/api/weather?city=${encodeURIComponent(city)}`
        );
        const res = await weatherGET(internalReq);
        const data = await res.json();

        return NextResponse.json(
          buildJsonRpcSuccess(id, {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          }),
          { headers: CORS_HEADERS }
        );
      }

      return NextResponse.json(
        buildJsonRpcError(id, -32601, `Tool not found: ${toolName}`),
        { status: 404, headers: CORS_HEADERS }
      );
    } catch (err) {
      if (err instanceof ReaderError && (err.code === 'missing_url' || err.code === 'invalid_url')) {
        return NextResponse.json(
          buildJsonRpcError(id, -32602, err.message),
          { status: 400, headers: CORS_HEADERS }
        );
      }
      return NextResponse.json(
        buildJsonRpcError(id, -32000, err instanceof Error ? err.message : 'Tool execution error'),
        { status: 500, headers: CORS_HEADERS }
      );
    }
  }

  return NextResponse.json(
    buildJsonRpcError(id, -32601, `Method not found: ${method}`),
    { status: 404, headers: CORS_HEADERS }
  );
}
