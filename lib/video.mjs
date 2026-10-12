// Shared video-URL helpers. Imported by the server, the validator and the browser
// (served at /lib/video.mjs), so keep this file dependency-free and DOM-free.

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Parse a social-media video URL into { platform, id, url }.
 * Returns null when the URL is not a supported video link.
 */
export function parseVideoUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    return null;
  }
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
