import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { extractUserProviderConfig, USER_PROVIDER_HEADER_MAP } from './user-provider-headers';
import { sanitizeTrustedBaseUrl } from './search-engine';
import type { UserProviderConfig } from './search-types';

export const PROVIDER_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-pharol-providers' : 'pharol-providers';
export const CREDENTIAL_TTL_SECONDS = 8 * 60 * 60;
const AAD = Buffer.from('pharol-provider-credentials-v1');

export function credentialKey(): Buffer | null {
  const value = process.env.PHAROL_CREDENTIAL_SECRET;
  return value && /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : null;
}

export function providerStatus(config: UserProviderConfig) {
  return Object.fromEntries(USER_PROVIDER_HEADER_MAP.map(([field]) => [field, Boolean(config[field])]));
}

export function patchProviders(current: UserProviderConfig, patch: unknown): UserProviderConfig {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Expected a provider settings object');
  const next = { ...current };
  for (const [field, value] of Object.entries(patch)) {
    if (!USER_PROVIDER_HEADER_MAP.some(([name]) => name === field)) throw new Error(`Unknown provider setting: ${field}`);
    const name = field as keyof UserProviderConfig;
    if (value === null) { delete next[name]; continue; }
    if (typeof value !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(value.trim())) {
      throw new Error(`Invalid value for ${field}: keys must contain 1–512 printable characters without spaces`);
    }
    if (name === 'openDeepWikiUrl') {
      const url = sanitizeTrustedBaseUrl(value.trim());
      if (!url) throw new Error(`${field} must be a trusted HTTPS URL or local HTTP endpoint`);
      next[name] = url;
    } else next[name] = value.trim();
  }
  if (Buffer.byteLength(JSON.stringify(next)) > 2500) throw new Error('Combined provider settings are too large');
  return next;
}

export function sealProviders(config: UserProviderConfig, now = Date.now()): string {
  const key = credentialKey();
  if (!key) throw new Error('Secure key storage is not configured on this server');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const text = JSON.stringify({ v: 1, expires: now + CREDENTIAL_TTL_SECONDS * 1000, config });
  const ciphertext = Buffer.concat([cipher.update(text), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function openProviders(value: string | undefined, now = Date.now()): UserProviderConfig {
  const key = credentialKey();
  if (!key || !value || value.length > 3800) return {};
  try {
    const bytes = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(AAD);
    decipher.setAuthTag(bytes.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    if (data.v !== 1 || !Number.isFinite(data.expires) || data.expires <= now) return {};
    return patchProviders({}, data.config);
  } catch { return {}; }
}

export function providerOrigin(req: Request): string {
  if (process.env.PHAROL_ORIGIN) return new URL(process.env.PHAROL_ORIGIN).origin;
  const url = new URL(req.url);
  // Next standalone may use its bind address in req.url. Host is the browser's
  // destination authority; cross-origin browser code cannot override it.
  url.host = req.headers.get('host') || url.host;
  return url.origin;
}

export function sameOrigin(req: Request, requireOrigin = false): boolean {
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) return false;
  const expected = providerOrigin(req);
  return origin ? origin === expected : !requireOrigin;
}

export function requestProviders(req: Request): UserProviderConfig {
  const value = req.headers.get('cookie')?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${PROVIDER_COOKIE}=`))?.slice(PROVIDER_COOKIE.length + 1);
  // Browser cookies are accepted only on same-origin requests. External MCP clients
  // can supply their own explicit provider headers without receiving browser keys.
  const cookieConfig = sameOrigin(req) ? openProviders(value) : {};
  return { ...cookieConfig, ...extractUserProviderConfig(req.headers) };
}
