import { UserProviderConfig } from './search-types';

export const USER_PROVIDER_HEADER_MAP: Array<[keyof UserProviderConfig, string]> = [
  ['context7ApiKey', 'x-pharol-context7-key'],
  ['semanticScholarApiKey', 'x-pharol-s2-key'],
  ['coreApiKey', 'x-pharol-core-key'],
  ['openAlexApiKey', 'x-pharol-openalex-key'],
  ['githubToken', 'x-pharol-github-token'],
  ['exaApiKey', 'x-pharol-exa-key'],
  ['firecrawlApiKey', 'x-pharol-firecrawl-key'],
  ['tavilyApiKey', 'x-pharol-tavily-key'],
  ['parallelApiKey', 'x-pharol-parallel-key'],
  ['keenableApiKey', 'x-pharol-keenable-key'],
  ['tinyfishApiKey', 'x-pharol-tinyfish-key'],
  ['openDeepWikiUrl', 'x-pharol-opendeepwiki-url'],
];

export function buildUserProviderHeaders(config?: UserProviderConfig | null): Record<string, string> {
  if (!config) return {};
  const headers: Record<string, string> = {};
  for (const [field, headerName] of USER_PROVIDER_HEADER_MAP) {
    const val = config[field];
    if (typeof val === 'string' && val.trim()) {
      headers[headerName] = val.trim();
    }
  }
  return headers;
}

export function extractUserProviderConfig(headers: Headers): UserProviderConfig {
  const config: UserProviderConfig = {};
  for (const [field, headerName] of USER_PROVIDER_HEADER_MAP) {
    const val = headers.get(headerName);
    if (typeof val === 'string' && val.trim()) {
      config[field] = val.trim();
    }
  }
  return config;
}
