/**
 * Turn a link the super admin pasted (YouTube, Vimeo, Instagram, Facebook, TikTok) into the address of that platform's embed player.
 * Only a short allow-list of hosts and exact URL shapes is accepted; anything else returns null and the site shows a plain "open" link
 * instead. YouTube uses the privacy-enhanced domain. The player is only loaded after a visitor presses Play (see MediaEmbed).
 */
export interface Embed { platform: 'youtube' | 'vimeo' | 'instagram' | 'facebook' | 'tiktok'; src: string }

const host = (u: URL) => u.hostname.toLowerCase().replace(/^(www|m|web|mobile)\./, '');

export function embedFor(raw: string): Embed | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = host(u);
  const p = u.pathname;

  if (h === 'youtube.com' || h === 'youtu.be' || h === 'youtube-nocookie.com') {
    const id = h === 'youtu.be' ? p.slice(1).split('/')[0]
      : p === '/watch' ? u.searchParams.get('v')
      : /^\/(shorts|embed|live)\/([\w-]{11})/.exec(p)?.[2];
    return id && /^[\w-]{11}$/.test(id) ? { platform: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1` } : null;
  }
  if (h === 'vimeo.com' || h === 'player.vimeo.com') {
    const id = /^\/(?:video\/)?(\d{6,12})(?:\/|$)/.exec(p)?.[1];
    return id ? { platform: 'vimeo', src: `https://player.vimeo.com/video/${id}?dnt=1` } : null;
  }
  if (h === 'instagram.com') {
    const m = /^\/(reel|reels|p|tv)\/([\w-]{5,20})/.exec(p);
    return m ? { platform: 'instagram', src: `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed` } : null;
  }
  if (h === 'facebook.com' || h === 'fb.watch') {
    const ok = h === 'fb.watch' || /\/(videos|reel|watch)\b/.test(p);
    return ok ? { platform: 'facebook', src: `https://www.facebook.com/plugins/video.php?show_text=false&href=${encodeURIComponent(u.toString())}` } : null;
  }
  if (h === 'tiktok.com') {
    const id = /\/video\/(\d{8,25})/.exec(p)?.[1];
    return id ? { platform: 'tiktok', src: `https://www.tiktok.com/embed/v2/${id}` } : null;
  }
  return null;
}

/** Short label for the admin page: which platform a pasted link was recognised as. */
export const platformOf = (raw: string): Embed['platform'] | null => embedFor(raw)?.platform ?? null;
