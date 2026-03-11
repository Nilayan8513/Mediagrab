import { spawn } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { analyzeWithInstaloader } from "./instaloader";
import { scrapeFacebookPhotos, isFacebookPhotoUrl } from "./facebook-photo";
import { analyzeTwitterUrl } from "./twitter-scraper";
import { resolve } from "path";

// ─── Cookie Handling ──────────────────────────────────────────────────────────

const COOKIES_FILE = resolve(process.cwd(), "cookies.txt");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function getCookieArgs(_tool: "yt-dlp" | "gallery-dl"): string[] {
  // Priority 1: YTDLP_COOKIES env var (base64-encoded Netscape cookies.txt)
  if (process.env.YTDLP_COOKIES) {
    try {
      const tempDir = process.env.TEMP || process.env.TMP || "/tmp";
      const tempCookieFile = join(tempDir, "cookies_temp.txt");
      writeFileSync(
        tempCookieFile,
        Buffer.from(process.env.YTDLP_COOKIES, "base64").toString("utf8")
      );
      console.log("[cookies] Using YTDLP_COOKIES env var");
      return ["--cookies", tempCookieFile];
    } catch (err) {
      console.error("Failed to decode YTDLP_COOKIES env var:", err);
    }
  }
  // Priority 2: cookies.txt file on disk
  if (existsSync(COOKIES_FILE)) {
    console.log("[cookies] Using cookies.txt file");
    return ["--cookies", COOKIES_FILE];
  }
  // NOTE: We intentionally do NOT fall back to --cookies-from-browser.
  // On headless servers (Render, Docker), `yt-dlp --cookies-from-browser firefox --version`
  // exits with code 0 (version flag short-circuits), making it look like browser cookies
  // are available when they're not. This causes yt-dlp to fail with a login error.
  console.log("[cookies] No cookies available — proceeding without auth");
  return [];
}

function shouldUseCookies(platform: Platform): boolean {
  return (
    platform === "instagram" ||
    platform === "twitter" ||
    platform === "facebook"
  );
}

// ─── Platform Detection ───────────────────────────────────────────────────────

export type Platform =
  | "instagram"
  | "twitter"
  | "facebook"
  | "unknown";

const PLATFORM_PATTERNS: { platform: Platform; regex: RegExp }[] = [
  {
    platform: "instagram",
    regex: /(?:instagram\.com\/(?:p|reel|reels|tv|stories)\/)/i,
  },
  {
    platform: "twitter",
    regex: /(?:(?:twitter|x)\.com\/\w+\/status\/)/i,
  },
  {
    platform: "facebook",
    regex: /(?:facebook\.com\/(?:(?:.*\/)?(?:videos|posts|watch|reel|photo|photos)|reel\/|share\/|watch\/|photo\.php|permalink\.php|story\.php)|fb\.watch\/|fb\.me\/)/i,
  },
];

export function detectPlatform(url: string): Platform {
  for (const { platform, regex } of PLATFORM_PATTERNS) {
    if (regex.test(url)) return platform;
  }
  return "unknown";
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MediaFormat {
  format_id: string;
  quality: string;
  ext: string;
  filesize: number | null;
  resolution: string | null;
  vcodec: string | null;
  acodec: string | null;
  height: number | null;
  fps: number | null;
  url: string | null;
  has_audio: boolean;
}

export interface MediaItem {
  type: "video" | "photo";
  title: string;
  thumbnail: string;
  duration: number | null;
  formats: MediaFormat[];
  direct_url: string | null;
  audio_url: string | null;
  index: number;
}

export interface MediaInfo {
  platform: Platform;
  title: string;
  uploader: string;
  items: MediaItem[];
  original_url: string;
}

// ─── Analyze URL ──────────────────────────────────────────────────────────────

export async function analyzeUrl(url: string): Promise<MediaInfo> {
  const platform = detectPlatform(url);

  // ── Instagram ──
  if (platform === "instagram") {
    const isStory = /instagram\.com\/stories\//i.test(url);
    let lastError = "";

    // For stories, try instaloader first (it handles stories with session cookies)
    if (isStory) {
      try {
        const result = await analyzeWithInstaloader(url, platform);
        if (result.items.length > 0) {
          console.log(`[analyze] instaloader returned ${result.items.length} story items`);
          return result;
        }
        lastError = "instaloader returned 0 items for story";
      } catch (err) {
        lastError = err instanceof Error ? err.message : "instaloader failed for story";
        console.error("instaloader failed for story, falling back to yt-dlp:", lastError);
      }
    }

    // For regular posts (not stories), try instaloader FIRST.
    // instaloader correctly handles mixed carousels (photos + videos),
    // while yt-dlp only extracts video entries and ignores photos.
    if (!isStory) {
      try {
        const result = await analyzeWithInstaloader(url, platform);
        if (result.items.length > 0) {
          console.log(`[analyze] instaloader returned ${result.items.length} items (${result.items.filter(i => i.type === "photo").length} photos, ${result.items.filter(i => i.type === "video").length} videos)`);
          return result;
        }
        lastError = "instaloader returned 0 items";
      } catch (err) {
        lastError = err instanceof Error ? err.message : "instaloader failed";
        console.error("instaloader failed, falling back to yt-dlp:", lastError);
      }
    }

    // Fallback to yt-dlp (works for videos with cookies, and as fallback for posts)
    let ytdlpNoVideoFormats = false;
    try {
      const result = await analyzeWithYtDlp(url, platform);
      if (result.items.length > 0) return result;
      lastError = "yt-dlp returned 0 items";
    } catch (err) {
      const ytdlpError = err instanceof Error ? err.message : "yt-dlp failed";
      console.error("yt-dlp also failed:", ytdlpError);
      if (!lastError) lastError = ytdlpError;

      if (ytdlpError.includes("No video formats found")) {
        // Photo-only post — let the embed scraper handle it below
        ytdlpNoVideoFormats = true;
      } else if (isStory && (ytdlpError.includes("login") || ytdlpError.includes("log in"))) {
        // Stories genuinely need auth — throw immediately, embed scraper can't help
        throw new Error(
          "Instagram Stories require authentication. " +
          "Please update your cookies.txt with fresh Instagram cookies."
        );
      }
      // For regular posts with any other error (including login errors), fall through
      // to the embed scraper — it works without auth for public posts.
    }

    // Final fallback: scrape photos from Instagram's public embed page.
    // This works even when instaloader / yt-dlp are blocked by Instagram's API.
    if (!isStory) {
      try {
        const result = await scrapeInstagramEmbedPhotos(url, platform);
        if (result.items.length > 0) {
          console.log(`[analyze] Instagram embed scraper returned ${result.items.length} items`);
          return result;
        }
      } catch (embedErr) {
        const embedError = embedErr instanceof Error ? embedErr.message : "embed scraper failed";
        console.error("Instagram embed scraper also failed:", embedError);
        if (!ytdlpNoVideoFormats) {
          // Only override lastError if it's a more informative message
          lastError = embedError || lastError;
        }
      }
    }

    throw new Error(
      `Could not extract media from this Instagram post. It may be private or rate-limited. (${lastError})`
    );
  }

  // ── Twitter/X: Use GraphQL scraper (no yt-dlp, direct mp4 URLs) ──
  if (platform === "twitter") {
    try {
      const result = await analyzeTwitterUrl(url);
      if (result.items.length > 0) return result;
    } catch (scraperErr) {
      console.error("Twitter scraper failed, trying yt-dlp:", scraperErr instanceof Error ? scraperErr.message : scraperErr);
    }
    // Fallback to yt-dlp (filtered to direct mp4 only)
    return await analyzeTwitterYtDlp(url);
  }

  // ── Facebook ──
  if (platform === "facebook") {
    return await analyzeFacebook(url);
  }

  throw new Error(
    "Unsupported platform. We support Instagram, Twitter/X, and Facebook."
  );
}

// ─── Instagram embed scraper (public, no auth needed) ────────────────────────
// Fetches https://www.instagram.com/p/{shortcode}/embed/ and parses the HTML
// to extract photo/video URLs. Works even when Instagram blocks API access.

async function scrapeInstagramEmbedPhotos(
  url: string,
  platform: Platform
): Promise<MediaInfo> {
  const shortcodeMatch = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (!shortcodeMatch) {
    throw new Error("Could not extract Instagram shortcode from URL");
  }
  const shortcode = shortcodeMatch[1];

  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
  console.log(`[instagram-embed] Fetching embed page: ${embedUrl}`);

  const response = await fetch(embedUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Instagram embed returned HTTP ${response.status}`);
  }

  const html = await response.text();
  console.log(`[instagram-embed] Got ${html.length} bytes`);

  const items: MediaItem[] = [];

  // ── Strategy 1: Parse window.__additionalDataLoaded / __initialData JSON blobs ──
  const jsonPatterns = [
    /window\.__additionalDataLoaded\s*\(\s*[^,]+,\s*([\s\S]+?\})\s*\);/,
    /window\._sharedData\s*=\s*([\s\S]+?\});\s*<\/script>/,
    /"gql_data"\s*:\s*([\s\S]+\})/,
  ];

  for (const pattern of jsonPatterns) {
    const m = html.match(pattern);
    if (!m) continue;
    try {
      const parsed = JSON.parse(m[1]);
      const mediaItems = extractFromInstagramJson(parsed, shortcode);
      if (mediaItems.length > 0) {
        items.push(...mediaItems);
        break;
      }
    } catch { /* try next pattern */ }
  }

  // ── Strategy 2: Pull image URLs from embedded <img> tags (og images) ──
  if (items.length === 0) {
    const imgPattern = /https:\/\/(?:scontent[^"'\s]+|cdninstagram[^"'\s]+)\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s]*)?/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = imgPattern.exec(html)) !== null) {
      const imgUrl = m[0].replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
      if (!seen.has(imgUrl)) {
        seen.add(imgUrl);
        items.push({
          type: "photo",
          title: `Instagram Post ${shortcode}`,
          thumbnail: imgUrl,
          duration: null,
          formats: [],
          direct_url: imgUrl,
          audio_url: null,
          index: items.length,
        });
      }
    }
  }

  // ── Strategy 3: Try oEmbed (returns thumbnail + title, basic fallback) ──
  if (items.length === 0) {
    const oembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}&maxwidth=1080`;
    try {
      const oRes = await fetch(oembedUrl, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (oRes.ok) {
        const oData = await oRes.json() as Record<string, unknown>;
        const thumbUrl = String(oData.thumbnail_url || "");
        if (thumbUrl) {
          items.push({
            type: "photo",
            title: String(oData.title || `Instagram Post ${shortcode}`),
            thumbnail: thumbUrl,
            duration: null,
            formats: [],
            direct_url: thumbUrl,
            audio_url: null,
            index: 0,
          });
        }
      }
    } catch { /* oEmbed failed */ }
  }

  if (items.length === 0) {
    throw new Error("Instagram embed scraper found no media");
  }

  // Deduplicate by direct_url
  const seenUrls = new Set<string>();
  const uniqueItems = items.filter((item) => {
    const key = item.direct_url || item.thumbnail;
    if (seenUrls.has(key)) return false;
    seenUrls.add(key);
    return true;
  }).map((item, idx) => ({ ...item, index: idx }));

  return {
    platform,
    title: `Instagram Post ${shortcode}`,
    uploader: "Instagram User",
    items: uniqueItems,
    original_url: url,
  };
}

/** Recursively walk an Instagram JSON blob to find media nodes */
function extractFromInstagramJson(
  obj: Record<string, unknown>,
  shortcode: string
): MediaItem[] {
  const items: MediaItem[] = [];

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const n = node as Record<string, unknown>;

    // Look for a media node with display_url (photo) or video_url (video)
    if (n.display_url || n.video_url) {
      const isVideo = !!n.video_url;
      const mediaUrl = String(n.video_url || n.display_url || "");
      const thumb = String(n.display_url || n.thumbnail_src || "");
      if (mediaUrl) {
        items.push({
          type: isVideo ? "video" : "photo",
          title: `Instagram Post ${shortcode}`,
          thumbnail: thumb,
          duration: (n.video_duration as number) || null,
          formats: isVideo
            ? [{
                format_id: "best",
                quality: "Best",
                ext: "mp4",
                filesize: null,
                resolution: null,
                vcodec: "avc1",
                acodec: "mp4a",
                height: null,
                fps: null,
                url: mediaUrl,
                has_audio: true,
              }]
            : [],
          direct_url: mediaUrl,
          audio_url: null,
          index: items.length,
        });
      }
    }

    // Walk children
    Object.values(n).forEach(walk);
  }

  walk(obj);
  return items;
}

// ─── Twitter yt-dlp fallback (only direct mp4 URLs) ──────────────────────────

async function analyzeTwitterYtDlp(url: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    const args = [
      "--dump-single-json",
      "--no-check-formats",  // Don't validate format availability
      "--skip-download",     // Don't try to download
      "--no-warnings",
      "--no-check-certificates",
      "--force-ipv4",
      "--user-agent", USER_AGENT,
      "--extractor-retries", "3",
      "--socket-timeout", "30",
      url,
    ];

    // Try without cookies first for Twitter (public tweets don't need auth)
    const proc = spawn("yt-dlp", args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        // Retry with cookies
        const cookieArgs = getCookieArgs("yt-dlp");
        if (cookieArgs.length > 0) {
          analyzeWithYtDlp(url, "twitter", true).then(resolve, () =>
            reject(new Error(stderr || "Failed to analyze Twitter URL"))
          );
        } else {
          reject(new Error(stderr || "Failed to analyze Twitter URL"));
        }
        return;
      }

      try {
        const data = JSON.parse(stdout);
        const result = parseTwitterData(data, url);
        resolve(result);
      } catch {
        reject(new Error("Failed to parse Twitter video info"));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`yt-dlp not found: ${err.message}`));
    });

    setTimeout(() => { proc.kill(); reject(new Error("yt-dlp timed out")); }, 60000);
  });
}

function parseTwitterData(data: Record<string, unknown>, url: string): MediaInfo {
  const allFormats = (data.formats as Record<string, unknown>[]) || [];

  // Helper: reject m3u8/HLS URLs — their segments have auth tokens that expire
  const isDirectUrl = (u: unknown) => {
    const s = String(u || "");
    return s.startsWith("http") && !s.includes(".m3u8") && !s.includes("m3u8");
  };

  // Separate video-only and audio-only streams
  const videoFormats = allFormats
    .filter((f) => {
      const vcodec = String(f.vcodec || "");
      const hasVideo = vcodec && vcodec !== "none";
      // Keep formats that have video AND a direct (non-m3u8) URL
      return hasVideo && f.url && isDirectUrl(f.url);
    })
    .map((f) => {
      const hasAudio = !!(f.acodec && String(f.acodec) !== "none");
      return {
        format_id: String(f.format_id || ""),
        quality: buildQualityLabel(f),
        ext: "mp4",
        filesize: (f.filesize as number) || (f.filesize_approx as number) || null,
        resolution: f.resolution ? String(f.resolution) : null,
        vcodec: f.vcodec ? String(f.vcodec) : null,
        acodec: f.acodec ? String(f.acodec) : null,
        height: (f.height as number) || null,
        fps: (f.fps as number) || null,
        url: String(f.url),
        has_audio: hasAudio,
      };
    })
    .filter((f) => (f.height || 0) > 0)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  // Deduplicate by quality label
  const seen = new Set<string>();
  const uniqueFormats = videoFormats.filter((f) => {
    if (seen.has(f.quality)) return false;
    seen.add(f.quality);
    return true;
  });

  // Best audio-only stream (direct URLs only)
  const audioOnlyFormats = allFormats
    .filter((f) => {
      const acodec = String(f.acodec || "");
      const vcodec = String(f.vcodec || "none");
      return acodec !== "none" && acodec !== "" && (vcodec === "none" || !vcodec) && f.url && isDirectUrl(f.url);
    })
    .sort((a, b) => ((b.abr as number) || 0) - ((a.abr as number) || 0));

  let audioUrl: string | null =
    audioOnlyFormats.length > 0 ? String(audioOnlyFormats[0].url) : null;

  // If no separate audio stream, find the best combined format and use it as audio source
  if (!audioUrl) {
    const combined = allFormats
      .filter((f) => {
        const acodec = String(f.acodec || "");
        const vcodec = String(f.vcodec || "");
        return acodec !== "none" && acodec !== "" && vcodec !== "none" && f.url && isDirectUrl(f.url);
      })
      .sort((a, b) => ((b.height as number) || 0) - ((a.height as number) || 0));
    if (combined.length > 0) audioUrl = String(combined[0].url);
  }

  // If video formats have audio, mark them correctly
  const finalFormats = uniqueFormats.length > 0 ? uniqueFormats : [];

  // Thumbnail
  const thumbnail = String(data.thumbnail || "");
  const title = String(data.title || data.description || "Twitter Video").slice(0, 100);
  const uploader = String(data.uploader || data.channel || "Unknown");

  return {
    platform: "twitter",
    title,
    uploader,
    items: [
      {
        type: "video",
        title,
        thumbnail,
        duration: (data.duration as number) || null,
        formats: finalFormats,
        direct_url: null,
        audio_url: audioUrl,
        index: 0,
      },
    ],
    original_url: url,
  };
}

// ─── Facebook: client-side friendly ──────────────────────────────────────────

async function analyzeFacebook(url: string): Promise<MediaInfo> {
  // For photo-like URLs, try the dedicated photo scraper first.
  // This handles /share/p/, /photo, /posts (with photos), /permalink.php etc.
  // Video/reel URLs skip this and go directly to yt-dlp below.
  if (isFacebookPhotoUrl(url)) {
    try {
      const photoResult = await scrapeFacebookPhotos(url);
      if (photoResult.items.length > 0) {
        console.log(`[analyze] Facebook photo scraper returned ${photoResult.items.length} photos`);
        return photoResult;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "photo scraper failed";
      // If the scraper explicitly says NO_PHOTOS_FOUND, this might be a video post
      // disguised as a share link — fall through to yt-dlp
      if (!msg.includes("NO_PHOTOS_FOUND")) {
        console.error("[analyze] Facebook photo scraper error:", msg);
      } else {
        console.log("[analyze] No photos found, falling back to yt-dlp for video");
      }
    }
  }

  // Video/reel path (or photo scraper fallback) — uses yt-dlp unchanged
  const result = await analyzeWithYtDlp(url, "facebook");

  // Facebook often returns combined mp4 URLs — no merge needed
  // But if formats are video-only, ensure audio_url is set
  for (const item of result.items) {
    if (item.type === "video" && item.formats.length > 0) {
      // Check if best format has audio; if not, find one that does
      const hasCombined = item.formats.some((f) => f.has_audio && f.url);
      if (!hasCombined && !item.audio_url) {
        // Try to find any format with audio as the audio source
        const withAudio = item.formats.find((f) => f.has_audio);
        if (withAudio?.url) item.audio_url = withAudio.url;
      }
    }
  }

  return result;
}

// ─── Analyze with yt-dlp (generic) ───────────────────────────────────────────

async function analyzeWithYtDlp(
  url: string,
  platform: Platform,
  withCookies?: boolean
): Promise<MediaInfo> {
  if (withCookies === undefined) {
    withCookies = shouldUseCookies(platform);
  }

  return new Promise((resolve, reject) => {
    const args = [
      ...(withCookies ? getCookieArgs("yt-dlp") : []),
      "--dump-single-json",
      "--no-check-formats",  // Don't validate format availability during dump
      "--skip-download",     // Don't try to download during analysis
      "--no-warnings",
      "--no-check-certificates",
      "--force-ipv4",
      "--user-agent", USER_AGENT,
      "--extractor-retries", "3",
      "--socket-timeout", "30",
    ];

    args.push(url);

    console.log(
      `[analyze] ${platform}: yt-dlp ${withCookies ? "with" : "without"} cookies`
    );
    const proc = spawn("yt-dlp", args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        const isAuthError =
          stderr.includes("Sign in") ||
          stderr.includes("login") ||
          stderr.includes("log in") ||
          stderr.includes("authentication");

        if (withCookies && !isAuthError) {
          analyzeWithYtDlp(url, platform, false).then(resolve, reject);
          return;
        }
        reject(new Error(stderr || `yt-dlp exited with code ${code}`));
        return;
      }

      try {
        const data = JSON.parse(stdout);
        const items: MediaItem[] = [];

        if (data.entries && Array.isArray(data.entries)) {
          data.entries.forEach((entry: Record<string, unknown>, idx: number) => {
            const item = parseYtDlpEntry(entry, idx);
            if (item) items.push(item);
          });
        } else {
          const item = parseYtDlpEntry(data, 0);
          if (item) items.push(item);
        }

        resolve({
          platform,
          title: data.title || data.playlist_title || "Untitled",
          uploader:
            data.uploader ||
            data.channel ||
            data.playlist_uploader ||
            "Unknown",
          items,
          original_url: url,
        });
      } catch {
        reject(new Error("Failed to parse yt-dlp output"));
      }
    });

    proc.on("error", (err) => {
      reject(
        new Error(`Failed to run yt-dlp: ${err.message}. Is yt-dlp installed?`)
      );
    });

    setTimeout(
      () => { proc.kill(); reject(new Error("yt-dlp timed out")); },
      90000
    );
  });
}

function parseYtDlpEntry(
  data: Record<string, unknown>,
  index: number
): MediaItem | null {
  const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic"]);

  // Check if this entry is actually a photo (image) based on yt-dlp metadata
  const entryExt = String(data.ext || "").toLowerCase();
  const entryUrl = String(data.url || "");
  const entryDuration = data.duration as number | null | undefined;
  const isLikelyPhoto =
    IMAGE_EXTS.has(entryExt) ||
    (entryDuration === 0 || entryDuration === null || entryDuration === undefined) &&
    (entryUrl.match(/\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i) !== null);

  const formats: MediaFormat[] = (
    (data.formats as Record<string, unknown>[]) || []
  )
    .filter((f) => {
      if (!f.vcodec || f.vcodec === "none") return false;
      if (!f.url) return false;
      // If we already know this is a photo, skip video format parsing
      if (isLikelyPhoto) return false;
      return true;
    })
    .map((f) => {
      return {
        format_id: String(f.format_id || ""),
        quality: buildQualityLabel(f),
        ext: String(f.ext || "mp4"),
        filesize:
          (f.filesize as number) || (f.filesize_approx as number) || null,
        resolution: f.resolution ? String(f.resolution) : null,
        vcodec: f.vcodec ? String(f.vcodec) : null,
        acodec: f.acodec ? String(f.acodec) : null,
        height: (f.height as number) || null,
        fps: (f.fps as number) || null,
        url: String(f.url || ""),
        has_audio: !!(f.acodec && f.acodec !== "none"),
      };
    })
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  const seen = new Set<string>();
  const uniqueFormats = formats.filter((f) => {
    if (!f.quality || seen.has(f.quality)) return false;
    seen.add(f.quality);
    return true;
  });

  const finalFormats =
    uniqueFormats.length > 0
      ? uniqueFormats
      : formats.length > 0
        ? [formats[0]]
        : [];

  // Best audio-only stream
  let audioUrl: string | null = null;
  if (!isLikelyPhoto) {
    const audioFormats = ((data.formats as Record<string, unknown>[]) || [])
      .filter(
        (f) =>
          f.acodec &&
          f.acodec !== "none" &&
          (!f.vcodec || f.vcodec === "none")
      )
      .sort((a, b) => ((b.abr as number) || 0) - ((a.abr as number) || 0));
    if (audioFormats.length > 0 && audioFormats[0].url) {
      audioUrl = String(audioFormats[0].url);
    }
  }

  const isPhoto = isLikelyPhoto || finalFormats.length === 0;

  return {
    type: isPhoto ? "photo" : "video",
    title: String(data.title || data.description || "Untitled"),
    thumbnail: String(data.thumbnail || ""),
    duration: isPhoto ? null : ((data.duration as number) || null),
    formats: isPhoto ? [] : finalFormats,
    direct_url: isPhoto
      ? String(data.url || data.thumbnail || "")
      : null,
    audio_url: audioUrl,
    index,
  };
}

function buildQualityLabel(f: Record<string, unknown>): string {
  const height = f.height as number;
  const width = f.width as number;
  const formatNote = String(f.format_note || "").toLowerCase();

  if (!height) return String(f.format_note || f.resolution || "Unknown");

  if (formatNote.includes("4320") || formatNote.includes("8k")) return "8K";
  if (formatNote.includes("2160") || formatNote.includes("4k")) return "4K";

  if (width >= 7680 || height >= 4320) return "8K";
  if (width >= 3840 || height >= 2160) return "4K";
  if (width >= 2560 || height >= 1440) return "1440p";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  if (height >= 480) return "480p";
  if (height >= 360) return "360p";
  if (height >= 240) return "240p";
  return `${height}p`;
}

// ─── Progress Tracking ────────────────────────────────────────────────────────

export interface DownloadProgress {
  percent: number;
  speed: string;
  eta: string;
  status: "downloading" | "merging" | "complete" | "error";
  currentItem?: number;
  totalItems?: number;
}

const progressStore = new Map<string, DownloadProgress>();

export function setProgress(id: string, progress: DownloadProgress) {
  progressStore.set(id, progress);
}
export function getProgress(id: string): DownloadProgress | null {
  return progressStore.get(id) || null;
}
export function clearProgress(id: string) {
  progressStore.delete(id);
}

// ─── Server-side download helpers (Instagram / audio only) ───────────────────

function extractHeightFromFormatId(formatId: string): number {
  const match = formatId.match(/\d+/);
  if (match) {
    const height = parseInt(match[0], 10);
    if (height > 0 && height <= 4320) return height;
  }
  return 1440;
}

export function downloadVideo(
  url: string,
  formatId: string,
  downloadId: string
): Promise<{ filePath: string; filename: string }> {
  return new Promise((resolve, reject) => {
    const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
    const outTemplate = `${tmpDir}/mediagrab_${downloadId}.%(ext)s`;

    let formatString: string;
    if (formatId) {
      formatString = `${formatId}+bestaudio/bestvideo[height<=${extractHeightFromFormatId(formatId)}]+bestaudio/bestvideo+bestaudio/best[height<=1440]/best`;
    } else {
      formatString = "bestvideo[height<=1440][ext=mp4]+bestaudio[ext=m4a]/best[height<=1440]/best";
    }

    const args = [
      ...getCookieArgs("yt-dlp"),
      "-f",
      formatString,
      "--merge-output-format", "mp4",
      "--no-warnings",
      "--no-check-certificates",
      "--no-check-formats",
      "--force-ipv4",
      "--user-agent", USER_AGENT,
      "--extractor-retries", "3",
      "--socket-timeout", "30",
      "--newline",
      "-o", outTemplate,
      url,
    ];

    const proc = spawn("yt-dlp", args);
    let lastFile = "";

    proc.stdout.on("data", (chunk) => {
      const line = chunk.toString();
      const progressMatch = line.match(
        /\[download\]\s+([\d.]+)%\s+of.*?at\s+([\d.]+\w+\/s).*?ETA\s+(\S+)/
      );
      if (progressMatch) {
        setProgress(downloadId, {
          percent: parseFloat(progressMatch[1]),
          speed: progressMatch[2],
          eta: progressMatch[3],
          status: "downloading",
        });
      }
      if (line.includes("[Merger]") || line.includes("[ffmpeg]")) {
        setProgress(downloadId, { percent: 100, speed: "", eta: "", status: "merging" });
      }
      const destMatch = line.match(/\[(?:download|Merger)\].*?Destination:\s*(.+)/);
      if (destMatch) lastFile = destMatch[1].trim();
      const mergeMatch = line.match(/Merging formats into "(.+)"/);
      if (mergeMatch) lastFile = mergeMatch[1].trim();
    });

    let stderrOutput = "";
    proc.stderr.on("data", (chunk) => {
      const output = chunk.toString();
      stderrOutput += output;
      console.error("yt-dlp stderr:", output);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });

        if (stderrOutput.includes("Requested format is not available")) {
          reject(new Error("The selected video quality is not available for this video. Try a different quality option."));
        } else if (stderrOutput.includes("Sign in") || stderrOutput.includes("login")) {
          reject(new Error("Authentication required. Please ensure your cookies are up to date."));
        } else if (stderrOutput.includes("Video unavailable") || stderrOutput.includes("not available")) {
          reject(new Error("This video is not available (may be deleted, private, or geo-blocked)."));
        } else {
          reject(new Error(`Download failed: ${stderrOutput.split('\n')[0] || 'Unknown error'}`));
        }
        return;
      }
      setProgress(downloadId, { percent: 100, speed: "", eta: "", status: "complete" });

      const extensions = ["mp4", "webm", "mkv", "mp3", "m4a"];
      let outputFile = lastFile;
      if (!outputFile || !existsSync(outputFile)) {
        for (const ext of extensions) {
          const candidate = `${tmpDir}/mediagrab_${downloadId}.${ext}`;
          if (existsSync(candidate)) { outputFile = candidate; break; }
        }
      }
      if (!outputFile || !existsSync(outputFile)) {
        reject(new Error("Download completed but output file not found"));
        return;
      }
      const { basename } = require("path");
      resolve({ filePath: outputFile, filename: basename(outputFile) });
    });

    proc.on("error", (err) => {
      setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
      reject(new Error(`Failed to run yt-dlp: ${err.message}`));
    });

    setTimeout(
      () => { proc.kill(); reject(new Error("Download timed out")); },
      300000
    );
  });
}

export function downloadAudio(
  url: string,
  downloadId: string
): Promise<{ filePath: string; filename: string }> {
  return new Promise((resolve, reject) => {
    const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
    const outTemplate = `${tmpDir}/mediagrab_audio_${downloadId}.%(ext)s`;

    const args = [
      ...getCookieArgs("yt-dlp"),
      "-f", "bestaudio",
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "--no-warnings",
      "--no-check-certificates",
      "--force-ipv4",
      "--user-agent", USER_AGENT,
      "--extractor-retries", "3",
      "--newline",
      "-o", outTemplate,
      url,
    ];

    const proc = spawn("yt-dlp", args);
    let lastFile = "";

    proc.stdout.on("data", (chunk) => {
      const line = chunk.toString();
      const progressMatch = line.match(
        /\[download\]\s+([\d.]+)%\s+of.*?at\s+([\d.]+\w+\/s).*?ETA\s+(\S+)/
      );
      if (progressMatch) {
        setProgress(downloadId, {
          percent: parseFloat(progressMatch[1]),
          speed: progressMatch[2],
          eta: progressMatch[3],
          status: "downloading",
        });
      }
      if (line.includes("[ffmpeg]") || line.includes("[ExtractAudio]")) {
        setProgress(downloadId, { percent: 95, speed: "", eta: "", status: "merging" });
      }
      const destMatch = line.match(
        /\[(?:download|ffmpeg|ExtractAudio)\].*?Destination:\s*(.+)/
      );
      if (destMatch) lastFile = destMatch[1].trim();
    });

    proc.stderr.on("data", (chunk) => {
      console.error("yt-dlp audio stderr:", chunk.toString());
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
        reject(new Error(`yt-dlp audio exited with code ${code}`));
        return;
      }
      setProgress(downloadId, { percent: 100, speed: "", eta: "", status: "complete" });

      const extensions = ["mp3", "m4a", "opus", "ogg", "wav", "webm"];
      let outputFile = lastFile;
      if (!outputFile || !existsSync(outputFile)) {
        for (const ext of extensions) {
          const candidate = `${tmpDir}/mediagrab_audio_${downloadId}.${ext}`;
          if (existsSync(candidate)) { outputFile = candidate; break; }
        }
      }
      if (!outputFile || !existsSync(outputFile)) {
        reject(new Error("Audio download completed but output file not found"));
        return;
      }
      const { basename } = require("path");
      resolve({ filePath: outputFile, filename: basename(outputFile) });
    });

    proc.on("error", (err) => {
      setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
      reject(new Error(`Failed to run yt-dlp: ${err.message}`));
    });

    setTimeout(
      () => { proc.kill(); reject(new Error("Audio download timed out")); },
      300000
    );
  });
}

export async function downloadPhoto(
  imageUrl: string,
  downloadId: string
): Promise<{ filePath: string; filename: string }> {
  setProgress(downloadId, { percent: 10, speed: "", eta: "", status: "downloading" });

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  };

  if (imageUrl.includes("pbs.twimg.com") || imageUrl.includes("ton.twitter.com")) {
    headers["Referer"] = "https://x.com/";
  } else if (imageUrl.includes("fbcdn") || imageUrl.includes("facebook.com")) {
    headers["Referer"] = "https://www.facebook.com/";
  } else if (imageUrl.includes("cdninstagram") || imageUrl.includes("scontent")) {
    headers["Referer"] = "https://www.instagram.com/";
  }

  const response = await fetch(imageUrl, { headers });
  if (!response.ok) {
    setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  setProgress(downloadId, { percent: 50, speed: "", eta: "", status: "downloading" });

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "image/jpeg";
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
  };
  const ext = extMap[contentType] || "jpg";
  const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
  const filePath = join(tmpDir, `mediagrab_${downloadId}.${ext}`);
  writeFileSync(filePath, buffer);

  setProgress(downloadId, { percent: 100, speed: "", eta: "", status: "complete" });
  return { filePath, filename: `photo_${downloadId}.${ext}` };
}

export function downloadWithGalleryDl(
  url: string,
  downloadId: string,
  itemIndex?: number
): Promise<{ filePath: string; filename: string; isZip?: boolean }> {
  return new Promise((resolve, reject) => {
    const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
    const outDir = join(tmpDir, `mediagrab_gdl_${downloadId}`);
    mkdirSync(outDir, { recursive: true });

    const args = [
      ...getCookieArgs("gallery-dl"),
      "--dest", outDir,
      "--filename", "{num:>02}.{extension}",
      "--no-mtime",
      url,
    ];
    if (itemIndex !== undefined) {
      args.splice(0, 0, "--range", `${itemIndex + 1}`);
    }

    const proc = spawn("gallery-dl", args);
    let fileCount = 0;
    setProgress(downloadId, { percent: 10, speed: "", eta: "", status: "downloading" });

    proc.stdout.on("data", (chunk) => {
      const line = chunk.toString();
      if (line.includes("/")) {
        fileCount++;
        setProgress(downloadId, {
          percent: Math.min(90, 10 + fileCount * 20),
          speed: "",
          eta: "",
          status: "downloading",
        });
      }
    });

    proc.stderr.on("data", (chunk) => {
      console.error("gallery-dl stderr:", chunk.toString());
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
        reject(new Error(`gallery-dl exited with code ${code}`));
        return;
      }
      const files = findFilesRecursive(outDir);
      if (files.length === 0) {
        reject(new Error("No files were downloaded"));
        return;
      }
      setProgress(downloadId, { percent: 100, speed: "", eta: "", status: "complete" });
      if (files.length === 1) {
        const { basename } = require("path");
        resolve({ filePath: files[0], filename: basename(files[0]) });
      } else {
        resolve({ filePath: outDir, filename: `mediagrab_${downloadId}`, isZip: true });
      }
    });

    proc.on("error", (err) => {
      setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
      reject(new Error(`Failed to run gallery-dl: ${err.message}`));
    });

    setTimeout(
      () => { proc.kill(); reject(new Error("Download timed out")); },
      300000
    );
  });
}

function findFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}
