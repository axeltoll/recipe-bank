// Server-side, best-effort resolution only. Never fetch arbitrary web sources.
import { parseVideoUrl } from './video.mjs';

const SHORT_HOSTS = new Set(['fb.watch', 'pin.it', 'vm.tiktok.com', 'vt.tiktok.com']);
const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function allowed(url, platform) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (platform === 'tiktok' && !TIKTOK_HOSTS.has(url.hostname)) return false;
  // The shared parser checks exact Facebook and Pinterest hosts and URL shapes.
  return parseVideoUrl(url.href)?.platform === platform;
}

/** Resolve a short link with HEAD requests, <= 3 redirects and one 3 s budget. */
export async function resolveShortVideo(video) {
  if (!video || video.id) return video;
  try {
    let current = new URL(video.url);
    if (!SHORT_HOSTS.has(current.hostname) || !allowed(current, video.platform)) return video;
    const signal = AbortSignal.timeout(3000);
    const seen = new Set();
    for (let hop = 0; hop <= 3; hop++) {
      if (seen.has(current.href)) return video;
      seen.add(current.href);
      const res = await fetch(current.href, { method: 'HEAD', redirect: 'manual', signal });
      if (REDIRECTS.has(res.status)) {
        const location = res.headers.get('location');
        if (hop === 3 || !location) return video;
        const next = new URL(location, current);
        if (!allowed(next, video.platform)) return video;
        current = next;
      } else {
        if (!res.ok) return video;
        const parsed = parseVideoUrl(current.href);
        return parsed?.platform === video.platform && parsed.id ? parsed : video;
      }
    }
  } catch {
    // Timeouts, offline providers, missing locations and unsupported HEAD all
    // retain the original link. Queuing must remain possible without metadata.
  }
  return video;
}
