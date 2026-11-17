export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export const SEARX_MCP_SERVER_INFO = {
  name: 'pharol-mcp',
  version: '1.0.0',
};

export const SEARX_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'web_search',
    title: 'Web & Code Metasearch',
    description:
      'Run privacy-focused metasearch across DuckDuckGo, Bing, Wikipedia/Wikidata, Marginalia, Exa MCP, Exa Code, Context7, GitMCP, DeepWiki, MDN, npm, Crates.io, PyPI, Parallel MCP, Tavily, Firecrawl, FreeSerp, Keenable, TinyFish, GitHub, Stack Overflow, and Hacker News. Supports !bangs (!gh, !docs, !deepwiki, !pkg, !so, !arxiv, !paper, !dataset, !news, !wiki) and operators (site:, filetype:, intitle:, "exact", -exclude).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string (supports !bangs and site:/filetype: operators).' },
        category: {
          type: 'string',
          enum: ['all', 'code', 'science', 'news', 'images', 'videos'],
          description: 'Search vertical category (default: all).',
        },
        timeRange: {
          type: 'string',
          enum: ['all', 'day', 'week', 'month', 'year'],
          description: 'Optional freshness window.',
        },
        engines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of engine IDs to query (e.g. ["exa", "tavily", "duckduckgo"]).',
        },
        page: { type: 'integer', minimum: 1, maximum: 5, description: 'Page number (default: 1).' },
        region: {
          type: 'string',
          enum: ['auto', 'global', 'pt-PT', 'pt-BR', 'en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE'],
          description: 'Optional country/language targeting (default: auto).',
        },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'news_search',
    title: 'Direct Open-Access News Search',
    description:
      'Fetch breaking news or search direct publisher headlines from BBC, NPR, The Guardian, Ars Technica, RTP, Observador, ECO, Notícias ao Minuto, Público, Firecrawl News, Tavily News, TinyFish News, DuckDuckGo News, Bing News, and Hacker News with open-access / free-wire filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional topic or keyword search query.' },
        topic: {
          type: 'string',
          enum: ['TOP', 'TECHNOLOGY', 'SCIENCE', 'BUSINESS'],
          description: 'News wire category when browsing headlines (default: TOP).',
        },
        access: {
          type: 'string',
          enum: ['free', 'open-wire', 'all'],
          description: 'Source access filter: free (hides known subscription gates), open-wire (public wires only), or all.',
        },
        region: {
          type: 'string',
          enum: ['auto', 'global', 'pt-PT', 'pt-BR', 'en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE'],
          description: 'Optional regional news targeting (e.g. "pt-PT" for Portugal news wires, default: auto).',
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'academic_search',
    title: 'Academic & Paper Metasearch',
    description:
      'Search scholarly preprints, datasets, and peer-reviewed publications across OpenAlex, Semantic Scholar, OpenAIRE Graph, Europe PMC, PubMed, INSPIRE-HEP, HAL Open Archive, CrossRef, DataCite, and arXiv, with Wikipedia/OpenAlex concept overviews kept strictly separate from paper ranking.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Academic paper, author, or scientific topic query.' },
        page: { type: 'integer', minimum: 1, maximum: 5, description: 'Page number (default: 1).' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'read_webpage',
    title: 'Reader Mode Webpage Extractor',
    description:
      'Extract clean article text, structured headings, code blocks, and metadata from any open-access URL using Wikipedia/arXiv/DeepWiki/GitHub APIs, Readability HTML parsing, and Jina/Firecrawl/Keenable markdown fallbacks. Respects subscription gates transparently.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target HTTP(S) webpage, Wikipedia article, DeepWiki repo, arXiv paper, or GitHub repo URL.' },
      },
      required: ['url'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'suggest_queries',
    title: 'Autocomplete Query Suggestions',
    description: 'Return live keyless search query autocomplete suggestions for a partial query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Partial query string (minimum 2 characters).' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'get_weather',
    title: 'City Weather Forecast',
    description: 'Retrieve current conditions and a 5-day forecast for any city via Open-Meteo.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name (e.g. "London", "Tokyo", "San Francisco").' },
      },
      required: ['city'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

export function buildJsonRpcSuccess(id: string | number | null, result: unknown) {
  return {
    jsonrpc: '2.0' as const,
    id,
    result,
  };
}

export function buildJsonRpcError(id: string | number | null, code: number, message: string) {
  return {
    jsonrpc: '2.0' as const,
    id,
    error: { code, message },
  };
}
