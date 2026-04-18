// Cloudflare Pages Function: /api/favicon?domain=example.com
// Server-side favicon proxy. Fetches from DuckDuckGo / Google / site-direct and returns
// the icon with permissive CORS headers so the client can convert it to a data URL
// (via canvas) for offline caching.
//
// Deploy: place this file at functions/api/favicon.js in your Pages project.
// Cloudflare auto-routes it to /api/favicon on your *.pages.dev domain.

const UPSTREAM = [
  (d) => `https://icons.duckduckgo.com/ip3/${d}.ico`,
  (d) => `https://www.google.com/s2/favicons?sz=64&domain=${d}`,
  (d) => `https://${d}/favicon.ico`
];

// 1×1 transparent PNG returned when nothing was found (avoids broken-image icons).
const TRANSPARENT_PNG = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82
]);

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const domain = (url.searchParams.get('domain') || '').toLowerCase().trim();

  // Strict domain validation — prevents SSRF to internal IPs, localhost, file://, etc.
  if (!domain || domain.length > 253 || !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(domain)) {
    return new Response('Invalid domain', { status: 400 });
  }

  for (const build of UPSTREAM) {
    try {
      const res = await fetch(build(domain), {
        cf: { cacheTtl: 2592000, cacheEverything: true },
        headers: { 'User-Agent': 'Mozilla/5.0 favicon-proxy' },
        redirect: 'follow'
      });
      if (!res.ok) continue;

      const ct = (res.headers.get('content-type') || 'image/x-icon').toLowerCase();
      if (!ct.startsWith('image/')) continue;

      const buf = await res.arrayBuffer();
      // Filter placeholder responses. DuckDuckGo returns a 1x1 transparent PNG (~70B)
      // for unknown domains; Google returns a generic globe (~400B) that's fine to keep.
      if (buf.byteLength < 120) continue;

      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': ct,
          'Access-Control-Allow-Origin': '*',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Cache-Control': 'public, max-age=2592000, s-maxage=2592000, immutable',
          'X-Favicon-Source': build(domain).split('/')[2]
        }
      });
    } catch (e) { /* try next upstream */ }
  }

  // Fallback: transparent PNG with 404, so <img> reports onerror to the client.
  return new Response(TRANSPARENT_PNG, {
    status: 404,
    headers: {
      'Content-Type': 'image/png',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400'
    }
  });
}

// Handle preflight for safety (browsers shouldn't actually send one for a GET <img>, but
// if anything ever calls this via fetch() with custom headers, be polite).
export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400'
    }
  });
}
