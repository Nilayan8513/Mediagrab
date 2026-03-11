/**
 * Facebook Photo Scraper
 *
 * Extracts full-resolution photos from Facebook posts (including /share/p/ links).
 * Works by fetching the page HTML and extracting image URLs from:
 *   1. Open Graph meta tags (og:image)
 *   2. Embedded JSON data in the page (for multi-photo posts)
 *   3. High-resolution image URLs from inline scripts
 *
 * This module is ONLY for photos. Video/Reel downloads remain handled by yt-dlp.
 */

import type { MediaInfo, MediaItem, Platform } from "./ytdlp";

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MOBILE_USER_AGENT =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// ─── URL pattern helpers ──────────────────────────────────────────────────────

/**
 * Determines if a Facebook URL is likely a photo post (vs video/reel).
 * This is used by analyzeFacebook to decide which scraper to try first.
 */
export function isFacebookPhotoUrl(url: string): boolean {
    const photoPatterns = [
        /facebook\.com\/share\/p\//i,
        /facebook\.com\/photo(?:\.php)?/i,
        /facebook\.com\/photo\//i,
        /facebook\.com\/[^/]+\/photos?\//i,
        /facebook\.com\/permalink\.php/i,
        /facebook\.com\/[^/]+\/posts\//i,
        /facebook\.com\/share\/(?!v\/)(?!r\/)/i,  // share but NOT share/v/ (video) or share/r/ (reel)
    ];

    // Explicitly NOT photo — these are video/reel URLs
    const videoPatterns = [
        /facebook\.com\/(?:.*\/)?videos?\//i,
        /facebook\.com\/reel\//i,
        /facebook\.com\/watch/i,
        /facebook\.com\/share\/v\//i,
        /facebook\.com\/share\/r\//i,
        /fb\.watch\//i,
    ];

    // If it matches a video pattern, it's not a photo URL
    for (const vp of videoPatterns) {
        if (vp.test(url)) return false;
    }

    // If it matches a photo pattern, it is a photo URL
    for (const pp of photoPatterns) {
        if (pp.test(url)) return true;
    }

    return false;
}

// ─── HTML fetching ────────────────────────────────────────────────────────────

async function fetchFacebookPage(url: string, mobile = false): Promise<{ html: string; finalUrl: string }> {
    const headers: Record<string, string> = {
        "User-Agent": mobile ? MOBILE_USER_AGENT : USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
    };

    const response = await fetch(url, {
        headers,
        redirect: "follow",
    });

    if (!response.ok) {
        throw new Error(`Facebook returned ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const finalUrl = response.url;

    return { html, finalUrl };
}

// ─── Image URL extraction ─────────────────────────────────────────────────────

function decodeEscapedUrl(raw: string): string {
    return raw
        .replace(/\\u0025/g, "%")
        .replace(/\\u003[cC]/g, "<")
        .replace(/\\u003[eE]/g, ">")
        .replace(/\\u0026/g, "&")
        .replace(/\\\//g, "/")
        .replace(/\\"/g, '"')
        .replace(/%25/g, "%");
}

function isHighResFacebookImage(url: string): boolean {
    // Filter out tiny icons, emojis, reaction images
    if (url.includes("emoji") || url.includes("reaction")) return false;
    if (url.includes("/rsrc.php/")) return false;
    if (url.includes("static.xx.fbcdn.net/rsrc")) return false;

    // Must be from Facebook's CDN
    const fbCdnPatterns = [
        /scontent[^.]*\.fbcdn\.net/i,
        /scontent[^.]*\.xx\.fbcdn\.net/i,
        /scontent[^.]*\.cdninstagram\.com/i,
        /external[^.]*\.fbcdn\.net/i,
        /z-m-scontent/i,
    ];

    return fbCdnPatterns.some(p => p.test(url));
}

/**
 * Extract photo URLs from OG meta tags
 */
function extractOgImages(html: string): string[] {
    const images: string[] = [];

    // Match og:image meta tags
    const ogPattern = /<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/gi;
    let match;
    while ((match = ogPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        if (decoded.startsWith("http")) {
            images.push(decoded);
        }
    }

    // Also try reversed attribute order
    const ogPatternReversed = /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/gi;
    while ((match = ogPatternReversed.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        if (decoded.startsWith("http") && !images.includes(decoded)) {
            images.push(decoded);
        }
    }

    return images;
}

/**
 * Extract high-resolution image URLs from Facebook's inline JSON/script data.
 * Facebook embeds image data in scripts — this pulls all scontent URLs.
 */
function extractScriptImages(html: string): string[] {
    const images: string[] = [];
    const seen = new Set<string>();

    // Pattern 1: Match high-res image URLs in JSON data (escaped format)
    // Facebook embeds URLs like "uri":"https:\/\/scontent..."
    const uriPattern = /"(?:uri|url|src|image_uri|full_image|photo_image|viewer_image|image\.uri|large_share_image)"\s*:\s*"(https?:\\?\/\\?\/[^"]+scontent[^"]+)"/gi;
    let match;
    while ((match = uriPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        if (isHighResFacebookImage(decoded) && !seen.has(decoded)) {
            seen.add(decoded);
            images.push(decoded);
        }
    }

    // Pattern 2: Match scontent URLs in any context (wider net)  
    const scontentPattern = /https?:(?:\\\/\\\/|\/\/)scontent[^"'\s\\]*?\.(?:jpg|jpeg|png|webp|gif)[^"'\s\\]*/gi;
    while ((match = scontentPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[0]);
        if (isHighResFacebookImage(decoded) && !seen.has(decoded)) {
            seen.add(decoded);
            images.push(decoded);
        }
    }

    return images;
}

/**
 * Extract title/description from OG or page
 */
function extractTitle(html: string): string {
    // Try og:title first
    const ogTitle = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']*?)["']/i)
        || html.match(/<meta\s+content=["']([^"']*?)["']\s+(?:property|name)=["']og:title["']/i);
    if (ogTitle?.[1]) return decodeHTMLEntities(ogTitle[1]).slice(0, 200);

    // Try og:description
    const ogDesc = html.match(/<meta\s+(?:property|name)=["']og:description["']\s+content=["']([^"']*?)["']/i)
        || html.match(/<meta\s+content=["']([^"']*?)["']\s+(?:property|name)=["']og:description["']/i);
    if (ogDesc?.[1]) return decodeHTMLEntities(ogDesc[1]).slice(0, 200);

    // Fallback to <title>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) return decodeHTMLEntities(titleMatch[1]).slice(0, 200);

    return "Facebook Post";
}

function extractUploader(html: string): string {
    // Try meta author
    const authorMatch = html.match(/<meta\s+(?:property|name)=["'](?:author|article:author)["']\s+content=["']([^"']*?)["']/i)
        || html.match(/<meta\s+content=["']([^"']*?)["']\s+(?:property|name)=["'](?:author|article:author)["']/i);
    if (authorMatch?.[1]) return decodeHTMLEntities(authorMatch[1]);

    // Try og:title — Facebook uses "Author Name - post text" format
    const ogTitle = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']*?)["']/i)
        || html.match(/<meta\s+content=["']([^"']*?)["']\s+(?:property|name)=["']og:title["']/i);
    if (ogTitle?.[1]) {
        const parts = ogTitle[1].split(/\s*[-–|]\s*/);
        if (parts.length > 1) return decodeHTMLEntities(parts[0]).trim();
    }

    return "Facebook User";
}

function decodeHTMLEntities(str: string): string {
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/");
}

/**
 * Pick the best (highest resolution) images from a set of candidates.
 * Facebook often returns the same image at multiple resolutions —
 * group by base path and pick the largest.
 */
function deduplicateImages(urls: string[]): string[] {
    if (urls.length <= 1) return urls;

    // Group URLs by their base image identifier
    // Facebook URLs typically: scontent-xxx.xx.fbcdn.net/v/tXX.XXXX-X/XXXXXXXXX_XXXXXX.jpg?...
    const groups = new Map<string, string[]>();

    for (const url of urls) {
        try {
            const parsed = new URL(url);
            // Use the filename (without query) as the grouping key
            const pathParts = parsed.pathname.split("/");
            const filename = pathParts[pathParts.length - 1] || "";
            // Strip resolution suffixes like _n, _o, _a, etc.
            const baseKey = filename.replace(/_[a-z](?=\.)/i, "");

            if (!groups.has(baseKey)) {
                groups.set(baseKey, []);
            }
            groups.get(baseKey)!.push(url);
        } catch {
            // If URL parsing fails, keep the URL as-is
            groups.set(url, [url]);
        }
    }

    // From each group, pick the URL with the largest dimensions hint
    const result: string[] = [];
    for (const [, group] of groups) {
        // Prefer URLs with larger dimension hints (e.g., _o > _n > _s)
        const best = group.sort((a, b) => {
            // Higher resolution hint: _o (original) > _n (normal) > _s (small)
            const scoreA = a.includes("_o.") ? 3 : a.includes("_n.") ? 2 : 1;
            const scoreB = b.includes("_o.") ? 3 : b.includes("_n.") ? 2 : 1;
            if (scoreA !== scoreB) return scoreB - scoreA;
            // Prefer longer URLs (usually have more quality params)
            return b.length - a.length;
        })[0];
        result.push(best);
    }

    return result;
}

// ─── Main scraper ─────────────────────────────────────────────────────────────

export async function scrapeFacebookPhotos(url: string): Promise<MediaInfo> {
    console.log(`[fb-photo] Scraping photos from: ${url}`);

    // Try desktop first (richer metadata), then mobile as fallback
    let html: string;
    let finalUrl: string;

    try {
        const result = await fetchFacebookPage(url, false);
        html = result.html;
        finalUrl = result.finalUrl;
    } catch (err) {
        console.error("[fb-photo] Desktop fetch failed, trying mobile:", err);
        const result = await fetchFacebookPage(url, true);
        html = result.html;
        finalUrl = result.finalUrl;
    }

    console.log(`[fb-photo] Page fetched (${html.length} bytes), final URL: ${finalUrl}`);

    // Check if Facebook is requiring login
    if (
        html.includes("login_form") ||
        html.includes("You must log in") ||
        (html.includes("/login/") && html.length < 50000 && !html.includes("og:image"))
    ) {
        throw new Error(
            "This Facebook post requires authentication. The post may be private or Facebook is requiring login."
        );
    }

    // Extract images from various sources
    const ogImages = extractOgImages(html);
    const scriptImages = extractScriptImages(html);

    console.log(`[fb-photo] Found ${ogImages.length} OG images, ${scriptImages.length} script images`);

    // Combine all found images, OG images first (they're usually the best quality)
    const allImages = [...ogImages];
    for (const img of scriptImages) {
        if (!allImages.includes(img)) {
            allImages.push(img);
        }
    }

    // Filter to only high-res CDN images
    const filteredImages = allImages.filter(img => {
        // Must be from Facebook CDN
        if (!img.includes("fbcdn.net") && !img.includes("facebook.com")) return false;
        // Skip very small images (profile pics, icons etc.)
        // Check for dimension hints in URL
        const widthMatch = img.match(/(?:_|\/|=)(\d+)x(\d+)/);
        if (widthMatch) {
            const w = parseInt(widthMatch[1]);
            const h = parseInt(widthMatch[2]);
            if (w < 200 && h < 200) return false;
        }
        return true;
    });

    // Deduplicate — keep highest resolution version of each image
    const uniqueImages = deduplicateImages(filteredImages.length > 0 ? filteredImages : allImages);

    console.log(`[fb-photo] After dedup: ${uniqueImages.length} unique images`);

    if (uniqueImages.length === 0) {
        throw new Error("NO_PHOTOS_FOUND");
    }

    // Extract metadata
    const title = extractTitle(html);
    const uploader = extractUploader(html);

    // Build MediaItems for each photo
    const items: MediaItem[] = uniqueImages.map((imageUrl, index) => ({
        type: "photo" as const,
        title: uniqueImages.length > 1 ? `Photo ${index + 1}` : title,
        thumbnail: imageUrl,
        duration: null,
        formats: [],
        direct_url: imageUrl,
        audio_url: null,
        index,
    }));

    return {
        platform: "facebook" as Platform,
        title,
        uploader,
        items,
        original_url: url,
    };
}
