import type { UserProviderConfig } from './search-types';

const ENV_KEYS = {
  context7ApiKey: 'CONTEXT7_API_KEY',
  semanticScholarApiKey: 'SEMANTIC_SCHOLAR_API_KEY',
  coreApiKey: 'CORE_API_KEY',
  openAlexApiKey: 'OPENALEX_API_KEY',
  githubToken: 'GITHUB_TOKEN',
  exaApiKey: 'EXA_API_KEY',
  firecrawlApiKey: 'FIRECRAWL_API_KEY',
  tavilyApiKey: 'TAVILY_API_KEY',
  parallelApiKey: 'PARALLEL_API_KEY',
  keenableApiKey: 'KEENABLE_API_KEY',
  tinyfishApiKey: 'TINYFISH_API_KEY',
} as const satisfies Record<Exclude<keyof UserProviderConfig, 'openDeepWikiUrl'>, string>;

const envFields = Object.keys(ENV_KEYS) as Array<keyof typeof ENV_KEYS>;
const providerFields = [...envFields, 'openDeepWikiUrl'] as const;

export interface ProviderContext {
  userConfig?: UserProviderConfig;
  providerDefaults?: UserProviderConfig;
}

/** Read operator settings at the entry point, not inside a service or provider. */
export function readOperatorProviders(env: Readonly<Record<string, string | undefined>>): UserProviderConfig {
  const config: UserProviderConfig = {};
  for (const field of envFields) {
    const value = env[ENV_KEYS[field]]?.trim();
    if (value) config[field] = value;
  }
  return config;
}

/** Omit unset keys so providers can opt into their existing keyless mode. */
export function resolveProviderConfig({ userConfig, providerDefaults }: ProviderContext = {}): UserProviderConfig {
  const config: UserProviderConfig = {};
  for (const field of providerFields) {
    const value = userConfig?.[field]?.trim() || providerDefaults?.[field]?.trim();
    if (value) config[field] = value;
  }
  return config;
}
