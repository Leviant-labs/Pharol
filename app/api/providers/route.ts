import { NextRequest, NextResponse } from 'next/server';
import {
  credentialKey, CREDENTIAL_TTL_SECONDS, openProviders, patchProviders,
  PROVIDER_COOKIE, providerOrigin, providerStatus, sameOrigin, sealProviders,
} from '@/lib/provider-credentials';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
const cookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const,
  path: '/', maxAge: CREDENTIAL_TTL_SECONDS,
};

export async function GET(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403, headers });
  return NextResponse.json({
    configured: providerStatus(openProviders(req.cookies.get(PROVIDER_COOKIE)?.value)),
    storageAvailable: Boolean(credentialKey()), expiresInHours: 8,
  }, { headers });
}

export async function PATCH(req: NextRequest) {
  if (!sameOrigin(req, true)) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403, headers });
  const origin = new URL(providerOrigin(req));
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
    return NextResponse.json({ error: 'HTTPS is required to save API keys' }, { status: 400, headers });
  }
  if (!credentialKey()) return NextResponse.json({ error: 'Secure key storage is not configured by the site administrator' }, { status: 503, headers });
  if (!req.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'JSON request required' }, { status: 415, headers });
  }
  try {
    const reader = req.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return NextResponse.json({ error: 'Settings request too large' }, { status: 413, headers }); }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks).toString();
    let patch: unknown;
    try { patch = JSON.parse(raw); }
    catch { return NextResponse.json({ error: 'Settings body must be valid JSON' }, { status: 400, headers }); }
    const config = patchProviders(openProviders(req.cookies.get(PROVIDER_COOKIE)?.value), patch);
    const response = NextResponse.json({ configured: providerStatus(config) }, { headers });
    response.cookies.set(PROVIDER_COOKIE, sealProviders(config), cookieOptions);
    return response;
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Invalid settings payload';
    return NextResponse.json({ error: message }, { status: 400, headers });
  }
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req, true)) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403, headers });
  const response = NextResponse.json({ configured: providerStatus({}) }, { headers });
  response.cookies.set(PROVIDER_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  return response;
}
