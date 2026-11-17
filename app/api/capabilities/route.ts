import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    envKeysActive: {
      exa: Boolean(process.env.EXA_API_KEY),
      parallel: Boolean(process.env.PARALLEL_API_KEY),
      tavily: Boolean(process.env.TAVILY_API_KEY),
      firecrawl: Boolean(process.env.FIRECRAWL_API_KEY),
      keenable: Boolean(process.env.KEENABLE_API_KEY),
      tinyfish: Boolean(process.env.TINYFISH_API_KEY),
      context7: Boolean(process.env.CONTEXT7_API_KEY),
      semanticscholar: Boolean(process.env.SEMANTIC_SCHOLAR_API_KEY),
      core: Boolean(process.env.CORE_API_KEY),
      openalex: Boolean(process.env.OPENALEX_API_KEY),
      github: Boolean(process.env.GITHUB_TOKEN),
      gemini: Boolean(process.env.GEMINI_API_KEY),
    },
    mcpEndpoint: '/api/mcp',
    openSearchUrl: '/opensearch.xml',
    searchTemplate: '/?q={searchTerms}',
  });
}
