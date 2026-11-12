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

// The root, www. or a two-letter language subdomain (br.pinterest.com, de.pinterest.com) of those domains.
function isPinterestHost(hostname) {
  const host = hostname.replace(/^(?:www|[a-z]{2})\./, '');
  return host.startsWith('pinterest.') && PINTEREST_DOMAINS.has(host.slice('pinterest.'.length));
}

// A Map, so a host named "constructor" or "__proto__" can never match an inherited property.
const SHORT_HOSTS = new Map([['fb.watch', 'facebook'], ['pin.it', 'pinterest'], ['vm.tiktok.com', 'tiktok'], ['vt.tiktok.com', 'tiktok']]);

// A web page needs a real public host name: dotted, not an IPv4 or IPv6 literal.
function isPublicHostName(hostname) {
  return hostname.includes('.') && !/^\d+(?:\.\d+){3}$/.test(hostname) && !hostname.startsWith('[');
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
  // "www.facebook.com." is the same host as "www.facebook.com": one trailing dot must not escape the lists.
  const hostname = u.hostname.replace(/\.$/, '');
  const host = hostname.replace(/^(www|m)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  // Short links need a redirect to resolve (lib/video-resolver.mjs). They are kept as
  // https://<host>/<code>: an http: link could never be resolved, and neither a share query (?si=…)
  // nor a trailing slash may make the same link a different queue entry.
  const shortPlatform = SHORT_HOSTS.get(hostname);
  if (shortPlatform) {
    const code = u.pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/)?.[1];
    if (code) return { platform: shortPlatform, id: null, url: `https://${hostname}/${code}` };
    // A full video URL on a TikTok short host is still parsed below; other short hosts have no other shape.
    if (shortPlatform !== 'tiktok') return null;
  }

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
    // The app's share sheet also gives https://www.tiktok.com/t/<code>/: a short link like vm.tiktok.com.
    const code = u.pathname.match(/^\/t\/([A-Za-z0-9_-]+)\/?$/)?.[1];
    return code ? { platform: 'tiktok', id: null, url: `https://www.tiktok.com/t/${code}` } : null;
  }
  if (host === 'instagram.com') {
    if (['reel', 'reels', 'p', 'tv'].includes(parts[0]) && parts[1]) {
      return { platform: 'instagram', id: parts[1], url: `https://www.instagram.com/reel/${parts[1]}/` };
    }
    return null;
  }
  if (['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com'].includes(hostname)) {
    // Share links (/share/r/<token>/ for reels, /share/v/<token>/ for videos) are short links like fb.watch.
    const share = u.pathname.match(/^\/share\/([rv])\/([A-Za-z0-9_-]+)\/?$/);
    if (share) return { platform: 'facebook', id: null, url: `https://www.facebook.com/share/${share[1]}/${share[2]}` };
    const id = /^\/watch\/?$/.test(u.pathname) ? u.searchParams.get('v')
      : u.pathname.match(/^\/(?:reel|[^/]+\/videos)\/(\d+)\/?$/)?.[1];
    return /^\d+$/.test(id ?? '')
      ? { platform: 'facebook', id, url: `https://www.facebook.com/watch/?v=${id}` }
      : null;
  }
  if (isPinterestHost(hostname)) {
    // "/pin/<id>/sent/" is where a shared pin.it link lands.
    const id = u.pathname.match(/^\/pin\/(\d+)(?:\/sent)?\/?$/)?.[1];
    return id ? { platform: 'pinterest', id, url: `https://www.pinterest.com/pin/${id}/` } : null;
  }
  if (['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(hostname)) {
    // The share sheet often adds /video/1 or /photo/1: the post is the same. /i/web/status/<id> has no user name.
    const match = u.pathname.match(/^\/(?:([A-Za-z0-9_]{1,15})|i\/web)\/status\/(\d+)(?:\/(?:video|photo)\/\d+)?\/?$/);
    if (!match) return null;
    return { platform: 'x', id: match[2], url: `https://x.com/${match[1] ?? 'i/web'}/status/${match[2]}` };
  }
  // Invalid links on known services (including redirector subdomains) must not
  // silently become web sources. No network requests are made for web pages.
  const serviceHosts = ['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'tiktok.com',
    'instagram.com', 'facebook.com', 'fb.watch', 'pin.it', 'x.com', 'twitter.com'];
  const serviceHost = serviceHosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))
    || hostname.split('.').includes('pinterest');
  if (allowWeb === true && u.protocol === 'https:' && !serviceHost && isPublicHostName(hostname)) {
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

/**
 * Stable key used to dedupe recipes and queue entries: `<platform>:<id>`, or for web pages and unresolved
 * short links their URL in the parser's normal form, so a stored "http://pin.it/AbC?si=1" and a new
 * "https://pin.it/AbC" are the same video.
 */
export function videoKey(video) {
  if (video?.id) return `${video.platform}:${video.id}`;
  const url = video?.url ?? '';
  return parseVideoUrl(url, { allowWeb: video?.platform === 'web' })?.url ?? url;
}
