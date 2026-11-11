import { describe, expect, it } from 'vitest';
import { embedFor } from '../apps/web/src/lib/embed';

describe('embedFor (pasted link → safe embed player address)', () => {
  it('recognises the common YouTube shapes and uses the privacy-enhanced domain', () => {
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=5', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/embed/dQw4w9WgXcQ']) {
      expect(embedFor(u)?.src, u).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1');
    }
  });
  it('Vimeo, Instagram reels/posts, TikTok and Facebook videos', () => {
    expect(embedFor('https://vimeo.com/76979871')?.src).toBe('https://player.vimeo.com/video/76979871?dnt=1');
    expect(embedFor('https://www.instagram.com/reel/Cabc123xyz/?igsh=1')?.src).toBe('https://www.instagram.com/reel/Cabc123xyz/embed');
    expect(embedFor('https://www.instagram.com/reels/Cabc123xyz/')?.src).toBe('https://www.instagram.com/reel/Cabc123xyz/embed');
    expect(embedFor('https://www.tiktok.com/@school/video/7234567890123456789')?.src).toBe('https://www.tiktok.com/embed/v2/7234567890123456789');
    expect(embedFor('https://www.facebook.com/someschool/videos/123456789/')?.platform).toBe('facebook');
    expect(embedFor('https://www.facebook.com/reel/987654321')?.src).toContain('plugins/video.php');
  });
  it('refuses anything else: other hosts, look-alike hosts, http, scripts, bad ids', () => {
    for (const u of ['https://example.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ',
      'http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'https://youtu.be/short', 'https://www.youtube.com/watch?v="><script>',
      'https://www.instagram.com/explore/', 'https://www.tiktok.com/@user', 'not a url', '']) {
      expect(embedFor(u), u).toBeNull();
    }
  });
});
