// Shared video-URL helpers. Imported by the server, the validator and the browser
// (served at /lib/video.mjs), so keep this file dependency-free and DOM-free.

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Platform labels and public embed capability (individual posts may be private). */
export const PLATFORMS = Object.freeze([
  { id: 'youtube', label: 'YouTube', embeds: true },
  { id: 'tiktok', label: 'TikTok', embeds: true },
  { id: 'instagram', label: 'Instagram', embeds: true },
  { id: 'facebook', label: 'Facebook', embeds: true },
  { id: 'pinterest', label: 'Pinterest', embeds: true },
  { id: 'x', label: 'X', embeds: false },
  { id: 'web', label: 'Web page', embeds: false },
].map(Object.freeze));
// Exact country domains, rather than a suffix match that could trust look-alikes.
const PINTEREST_DOMAINS = new Set([
  'com', 'at', 'be', 'ca', 'ch', 'cl', 'co.kr', 'co.uk', 'com.au', 'com.mx',
  'de', 'dk', 'es', 'fr', 'ie', 'in', 'it', 'jp', 'nz', 'ph', 'pt', 'ru', 'se',
]);

function isPinterestHost(host) {
  return host.startsWith('pinterest.') && PINTEREST_DOMAINS.has(host.slice('pinterest.'.length));
}

/**
 * Parse a video URL into { platform, id, url }.
 * Default: supported platform links only. allowWeb explicitly permits other
 * HTTPS pages as link-only sources; it does not verify that they contain video.
 */
export function parseVideoUrl(input, { allowWeb = false } = {}) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) return null;
  const host = u.hostname.replace(/^(www|m)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' && YT_ID.test(parts[0] ?? '')) {
    return youtube(parts[0]);
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    const v = u.searchParams.get('v');
    if (v && YT_ID.test(v)) return youtube(v);
    if (['shorts', 'embed', 'live', 'v'].includes(parts[0]) && YT_ID.test(parts[1] ?? '')) {
      return youtube(parts[1]);
    }
    return null;
  }
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    const i = parts.indexOf('video');
    if (i >= 0 && /^\d+$/.test(parts[i + 1] ?? '')) {
      const handle = parts.find((p) => p.startsWith('@')) ?? '';
      return {
        platform: 'tiktok',
        id: parts[i + 1],
        url: `https://www.tiktok.com/${handle ? handle + '/' : ''}video/${parts[i + 1]}`,
      };
    }
    // Short links (vm.tiktok.com/xyz) need a redirect to resolve; keep them as-is.
    if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
      return { platform: 'tiktok', id: null, url: u.href };
    }
    return null;
  }
  if (host === 'instagram.com') {
    if (['reel', 'reels', 'p', 'tv'].includes(parts[0]) && parts[1]) {
      return { platform: 'instagram', id: parts[1], url: `https://www.instagram.com/reel/${parts[1]}/` };
    }
    return null;
  }
  if (['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com'].includes(u.hostname)) {
    const id = /^\/watch\/?$/.test(u.pathname) ? u.searchParams.get('v')
      : u.pathname.match(/^\/(?:reel|[^/]+\/videos)\/(\d+)\/?$/)?.[1];
    return /^\d+$/.test(id ?? '')
      ? { platform: 'facebook', id, url: `https://www.facebook.com/watch/?v=${id}` }
      : null;
  }
  if (u.hostname === 'fb.watch' || u.hostname === 'pin.it') {
    if (!/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)) return null;
    return { platform: u.hostname === 'fb.watch' ? 'facebook' : 'pinterest', id: null, url: u.href };
  }
  if (isPinterestHost(u.hostname.replace(/^www\./, ''))) {
    const id = u.pathname.match(/^\/pin\/(\d+)\/?$/)?.[1];
    return id ? { platform: 'pinterest', id, url: `https://www.pinterest.com/pin/${id}/` } : null;
  }
  if (['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(u.hostname)) {
    const match = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
    return match ? { platform: 'x', id: match[2], url: `https://x.com/${match[1]}/status/${match[2]}` } : null;
  }
  // Invalid links on known services (including redirector subdomains) must not
  // silently become web sources. No network requests are made for web pages.
  const serviceHosts = ['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'tiktok.com',
    'instagram.com', 'facebook.com', 'fb.watch', 'pin.it', 'x.com', 'twitter.com'];
  const serviceHost = serviceHosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
    || u.hostname.split('.').includes('pinterest');
  if (allowWeb === true && u.protocol === 'https:' && !serviceHost) {
    return { platform: 'web', id: null, url: u.href };
  }
  return null;
}

function youtube(id) {
  return { platform: 'youtube', id, url: `https://www.youtube.com/shorts/${id}` };
}

/** iframe src for an embeddable player, or null. `start` is in seconds. */
export function embedUrl(video, { start = 0, autoplay = false } = {}) {
  if (!video?.id) return null;
  switch (video.platform) {
    case 'youtube': {
      const q = new URLSearchParams({ rel: '0', modestbranding: '1', playsinline: '1' });
      if (start > 0) q.set('start', String(Math.floor(start)));
      if (autoplay) q.set('autoplay', '1');
      return `https://www.youtube-nocookie.com/embed/${video.id}?${q}`;
    }
    case 'tiktok':
      return `https://www.tiktok.com/embed/v2/${video.id}`;
    case 'instagram':
      return `https://www.instagram.com/reel/${video.id}/embed`;
    case 'facebook': {
      if (!/^\d+$/.test(video.id)) return null;
      const q = new URLSearchParams({ href: `https://www.facebook.com/watch/?v=${video.id}`, show_text: 'false' });
      return `https://www.facebook.com/plugins/video.php?${q}`;
    }
    case 'pinterest':
      return /^\d+$/.test(video.id) ? `https://assets.pinterest.com/ext/embed.html?id=${video.id}` : null;
    default:
      return null;
  }
}

/** Poster image URL, or null when the platform has no stable public thumbnail. */
export function thumbnailUrl(video) {
  if (video?.platform === 'youtube' && video.id) {
    return `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
  }
  return null;
}

/** Stable key used to dedupe recipes and queue entries. */
export function videoKey(video) {
  return video?.id ? `${video.platform}:${video.id}` : video?.url ?? '';
}
