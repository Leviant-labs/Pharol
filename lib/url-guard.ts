import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response exceeded the ${Math.round(maxBytes / 1024)} KB size limit`);
    this.name = 'ResponseTooLargeError';
  }
}

export type HostLookup = (hostname: string) => Promise<Array<{ address: string }>>;

const MAX_URL_LENGTH = 2048;
const DNS_CACHE_TTL_MS = 60_000;
const DNS_CACHE_MAX = 256;
const DNS_TIMEOUT_MS = 1500;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.home.arpa',
  '.lan',
  '.corp',
  '.intranet',
];

const dnsCache = new Map<string, { addresses: string[]; expiresAt: number }>();

function isPrivateIpv4Octets(a: number, b: number, c: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return true; // Link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF / TEST-NET-1
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // Benchmark
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

function parseIpv6Groups(raw: string): number[] | null {
  const withoutZone = raw.split('%')[0].toLowerCase();
  const doubleColonParts = withoutZone.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(':');
    const groups: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.includes('.')) {
        if (i !== tokens.length - 1) return null;
        const octets = token.split('.').map(Number);
        if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
          return null;
        }
        groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
        groups.push(parseInt(token, 16));
      }
    }
    return groups;
  };

  const left = parseSide(doubleColonParts[0]);
  if (!left) return null;

  if (doubleColonParts.length === 1) {
    return left.length === 8 ? left : null;
  }

  const right = parseSide(doubleColonParts[1]);
  if (!right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const cleaned = ip.trim().replace(/^\[|\]$/g, '').split('%')[0];
  const version = isIP(cleaned);
  if (version === 4) {
    const [a, b, c] = cleaned.split('.').map(Number);
    return isPrivateIpv4Octets(a, b, c);
  }
  if (version === 6) {
    const g = parseIpv6Groups(cleaned);
    if (!g) return true;
    const allZeroPrefix = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
    // Unspecified (::) and IPv4-compatible (::/96, includes loopback ::1)
    if (allZeroPrefix && g[5] === 0) return true;
    // IPv4-mapped (::ffff:0:0/96)
    if (allZeroPrefix && g[5] === 0xffff) {
      return isPrivateIpv4Octets((g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff);
    }
    // NAT64 well-known prefix (64:ff9b::/96)
    if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
      return isPrivateIpv4Octets((g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff);
    }
    // Discard-only (100::/64)
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
    // Documentation (2001:db8::/32)
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
    // ULA (fc00::/7), link-local (fe80::/10), site-local (fec0::/10), multicast (ff00::/8)
    if ((g[0] & 0xfe00) === 0xfc00) return true;
    if ((g[0] & 0xffc0) === 0xfe80) return true;
    if ((g[0] & 0xffc0) === 0xfec0) return true;
    if ((g[0] & 0xff00) === 0xff00) return true;
    return false;
  }
  return true;
}

export function parsePublicHttpUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) {
    throw new UnsafeUrlError('URL must be a valid public HTTP(S) address');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UnsafeUrlError('URL must be a valid public HTTP(S) address');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeUrlError('Only public HTTP(S) URLs are supported');
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed');
  }
  const bareHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '');
  if (!bareHost) {
    throw new UnsafeUrlError('URL must include a public hostname');
  }
  if (isIP(bareHost)) {
    if (isPrivateOrReservedIp(bareHost)) {
      throw new UnsafeUrlError('Private, loopback, or reserved IP addresses are not allowed');
    }
    return parsed;
  }
  if (
    bareHost === 'localhost' ||
    !bareHost.includes('.') ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => bareHost.endsWith(suffix))
  ) {
    throw new UnsafeUrlError('Local or internal hostnames are not allowed');
  }
  return parsed;
}

async function resolveHostAddresses(hostname: string, lookupFn?: HostLookup): Promise<string[] | null> {
  if (!lookupFn) {
    const cached = dnsCache.get(hostname);
    if (cached && cached.expiresAt > Date.now()) return cached.addresses;
  }
  const query = lookupFn
    ? lookupFn(hostname)
    : dnsLookup(hostname, { all: true, verbatim: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      query,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), DNS_TIMEOUT_MS);
      }),
    ]);
    if (!records) return null;
    const addresses = records.map((record) => record.address);
    if (!lookupFn) {
      if (dnsCache.size >= DNS_CACHE_MAX) {
        const oldest = dnsCache.keys().next().value;
        if (oldest !== undefined) dnsCache.delete(oldest);
      }
      dnsCache.set(hostname, { addresses, expiresAt: Date.now() + DNS_CACHE_TTL_MS });
    }
    return addresses;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function assertPublicHttpUrl(rawUrl: string, lookupFn?: HostLookup): Promise<URL> {
  const parsed = parsePublicHttpUrl(rawUrl);
  const bareHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '');
  if (isIP(bareHost)) return parsed;

  const addresses = await resolveHostAddresses(bareHost, lookupFn);
  if (addresses && addresses.some((address) => isPrivateOrReservedIp(address))) {
    throw new UnsafeUrlError('URL resolves to a private or reserved network address');
  }
  return parsed;
}

export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new ResponseTooLargeError(maxBytes);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new ResponseTooLargeError(maxBytes);
    return text;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ResponseTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchPublicUrl(
  url: string,
  options: RequestInit = {},
  timeoutMs = 5000,
  maxRedirects = 5,
  lookupFn?: HostLookup
): Promise<{ response: Response; finalUrl: string }> {
  const signal = options.signal
    ? AbortSignal.any([AbortSignal.timeout(timeoutMs), options.signal])
    : AbortSignal.timeout(timeoutMs);

  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHttpUrl(currentUrl, lookupFn);
    const response = await fetch(currentUrl, {
      ...options,
      redirect: 'manual',
      signal,
    });
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) return { response, finalUrl: currentUrl };
      if (hop === maxRedirects) {
        throw new UnsafeUrlError('Too many redirects');
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return { response, finalUrl: response.url || currentUrl };
  }
  throw new UnsafeUrlError('Too many redirects');
}

export function clearUrlGuardDnsCache(): void {
  dnsCache.clear();
}
