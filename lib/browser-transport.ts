import { Impit } from 'impit';

export type BrowserProfile = 'chrome142' | 'firefox144';
export type BrowserRequestInit = Pick<RequestInit, 'headers' | 'redirect' | 'signal'> & {
  method?: 'GET' | 'POST'; body?: string;
};
const clients = new Map<BrowserProfile, Impit>();
const USER_AGENTS: Record<BrowserProfile, string> = {
  chrome142: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  firefox144: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0',
};

// Shared native connection pools; no browser process or persistent cookie jar.
export async function browserFetch(url: string, init: BrowserRequestInit = {}, browser: BrowserProfile = 'chrome142') {
  const headers = new Headers(init.headers);
  // Keep the claimed browser consistent with its TLS/HTTP fingerprint.
  headers.delete('user-agent');
  if (process.env.PHAROL_WEB_TRANSPORT === 'fetch') {
    headers.set('user-agent', USER_AGENTS[browser]);
    return fetch(url, { ...init, headers, cache: 'no-store' });
  }
  let client = clients.get(browser);
  if (!client) {
    client = new Impit({ browser, timeout: 4000, ignoreTlsErrors: false });
    clients.set(browser, client);
  }
  return client.fetch(url, {
    method: init.method,
    headers,
    body: init.body,
    redirect: init.redirect,
    signal: init.signal ?? undefined,
  });
}
