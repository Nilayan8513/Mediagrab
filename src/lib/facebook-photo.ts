/**
 * Facebook Photo Scraper
 *
 * Extracts full-resolution photos from Facebook posts (including /share/p/ links).
 * Uses multiple strategies:
 *   1. Desktop page with full browser headers (gets richest HTML)
 *   2. mbasic.facebook.com (simpler HTML, works from server IPs)
 *   3. Mobile page as fallback
 *
 * Key challenge: Facebook only puts 1 photo in initial HTML for multi-photo posts.
 * The rest are loaded via JavaScript. On server IPs (AWS), Facebook sometimes
 * serves more image data in the initial HTML.
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
        /facebook\.com\/\d+\/posts\//i,
        /facebook\.com\/story\.php/i,
        /facebook\.com\/share\/(?!v\/)(?!r\/)/i,
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

    for (const vp of videoPatterns) {
        if (vp.test(url)) return false;
    }

    for (const pp of photoPatterns) {
        if (pp.test(url)) return true;
    }

    return false;
}

// ─── HTML fetching ────────────────────────────────────────────────────────────

/**
 * Fetch a Facebook page with full browser-like headers.
 * The sec-ch-ua headers are CRITICAL — without them, Facebook serves a minimal
 * JS-only shell (~1.5KB) instead of the full page (~1.2MB) with embedded data.
 */
async function fetchFacebookPage(url: string, mobile = false): Promise<{ html: string; finalUrl: string }> {
    const headers: Record<string, string> = mobile ? {
        "User-Agent": MOBILE_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
    } : {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        // These headers are ESSENTIAL for getting the full Facebook page
        // Without them, Facebook returns a ~1.5KB JS-only shell
        "sec-ch-ua": '"Chromium";v="122", "Google Chrome";v="122"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
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
        .replace(/%25/g, "%")
        .replace(/&amp;/g, "&");
}

/**
 * Determine if a Facebook CDN URL is a POST photo (not a profile pic, emoji, or UI element).
 * Uses the URL path structure to distinguish:
 *   - t39.30808-6 = post/page photos (WANT these)
 *   - t39.30808-1 = profile pics (DON'T want)
 *   - t1.30497-1 = default profile pic (DON'T want)
 *   - t1.6435-1 = cover photos (DON'T want)
 */
function isPostPhoto(url: string): boolean {
    // Must be from Facebook CDN
    if (!url.includes("scontent") && !url.includes("fbcdn.net")) return false;

    // Filter out known non-photo URL patterns
    if (url.includes("emoji") || url.includes("reaction")) return false;
    if (url.includes("/rsrc.php/")) return false;
    if (url.includes("static.xx.fbcdn.net/rsrc")) return false;

    // Profile pic path patterns (NOT post photos)
    if (url.includes("t39.30808-1/")) return false;  // Profile pictures
    if (url.includes("t1.30497-1/")) return false;    // Default profile pic
    if (url.includes("t1.6435-1/")) return false;     // Cover photos
    if (url.includes("t39.30808-0/")) return false;   // App icons

    // Post photos use t39.30808-6 — allow these
    if (url.includes("t39.30808-6/")) return true;

    // Also allow other media types that could be post content
    if (url.includes("t39.30808-")) return true;

    return false;
}

function isHighResFacebookImage(url: string): boolean {
    if (url.includes("emoji") || url.includes("reaction")) return false;
    if (url.includes("/rsrc.php/")) return false;
    if (url.includes("static.xx.fbcdn.net/rsrc")) return false;

    const fbCdnPatterns = [
        /scontent[^.]*\.fbcdn\.net/i,
        /scontent[^.]*\.xx\.fbcdn\.net/i,
        /external[^.]*\.fbcdn\.net/i,
    ];

    return fbCdnPatterns.some(p => p.test(url));
}

/**
 * Extract photo URLs from OG meta tags.
 * On Facebook, og:image always contains the FIRST photo of a post at a reasonable resolution.
 */
function extractOgImages(html: string): string[] {
    const images: string[] = [];

    // Match og:image meta tags (both attribute orders)
    const patterns = [
        /<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/gi,
        /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/gi,
        // Also twitter:image (same image usually)
        /<meta\s+(?:property|name)=["']twitter:image["']\s+content=["']([^"']+)["']/gi,
        /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']twitter:image["']/gi,
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
            const decoded = decodeEscapedUrl(match[1]);
            if (decoded.startsWith("http") && decoded.includes("scontent") && !images.includes(decoded)) {
                images.push(decoded);
            }
        }
    }

    return images;
}

/**
 * Extract photo URLs from Facebook's inline Relay/Comet JSON data.
 * Facebook embeds image data in <script> tags as escaped JSON.
 *
 * Two URL formats exist in the HTML:
 *   1. Plain: https://scontent... (in meta tags, preload links)
 *   2. Escaped: https:\/\/scontent... (in JSON inside <script> tags)
 *
 * For multi-photo posts, the initial HTML MAY contain image data
 * for all photos (especially when fetched from server IPs / AWS).
 */
function extractScriptImages(html: string): string[] {
    const images: string[] = [];
    const seen = new Set<string>();

    // Pattern 1: Escaped scontent URLs in JSON (e.g., "uri":"https:\/\/scontent...")
    // Use \\\/ to match literal \/ in the HTML source
    const escapedPattern = /https?:\\\/\\\/scontent[^"']+/gi;
    let match;
    while ((match = escapedPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[0]);
        if (!seen.has(decoded) && isHighResFacebookImage(decoded)) {
            seen.add(decoded);
            images.push(decoded);
        }
    }

    // Pattern 2: Plain scontent URLs (in meta tags, preload links, etc.)
    const plainPattern = /https?:\/\/scontent[^"'\s<>\\]+/gi;
    while ((match = plainPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[0]);
        if (!seen.has(decoded) && isHighResFacebookImage(decoded)) {
            seen.add(decoded);
            images.push(decoded);
        }
    }

    // Pattern 3: URI fields in JSON with explicit keys
    const uriPattern = /"(?:uri|url|src|image_uri|full_image|photo_image|viewer_image|image\.uri|large_share_image|baseUrl)"\s*:\s*"(https?:[^"]+scontent[^"]+)"/gi;
    while ((match = uriPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        if (!seen.has(decoded) && isHighResFacebookImage(decoded)) {
            seen.add(decoded);
            images.push(decoded);
        }
    }

    return images;
}

/**
 * Extract images from mbasic.facebook.com page and its linked photo pages.
 * mbasic serves simple HTML with direct image links.
 * NOTE: mbasic does NOT support pfbid URLs — it returns an error page.
 */
async function extractMbasicPhotos(url: string): Promise<string[]> {
    const images: string[] = [];

    // Convert to mbasic URL
    const mbasicUrl = url
        .replace(/^https?:\/\/(www\.)?facebook\.com/, "https://mbasic.facebook.com")
        .replace(/^https?:\/\/m\.facebook\.com/, "https://mbasic.facebook.com");

    console.log(`[fb-photo] mbasic: fetching ${mbasicUrl}`);

    const { html } = await fetchFacebookPage(mbasicUrl, false);
    console.log(`[fb-photo] mbasic: ${html.length} bytes`);

    // Check for error page (mbasic doesn't support pfbid URLs)
    if (html.includes("went wrong") || html.includes("Back to Home") || html.length < 5000) {
        console.log("[fb-photo] mbasic: error page or too small, skipping");
        return images;
    }

    // Check for login wall
    if (html.includes("login_form") && html.length < 20000) {
        console.log("[fb-photo] mbasic: login wall, skipping");
        return images;
    }

    // Extract direct image URLs
    const imgPattern = /<img[^>]+src=["'](https?:\/\/scontent[^"']+)["'][^>]*>/gi;
    const seen = new Set<string>();
    let match;
    while ((match = imgPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        if (!seen.has(decoded)) {
            seen.add(decoded);
            images.push(decoded);
        }
    }

    // Find links to individual photo pages (/photo.php?fbid=...)
    const photoLinks: string[] = [];
    const fbidPattern = /href=["'](\/photo\.php\?fbid=\d+[^"']*)["']/gi;
    while ((match = fbidPattern.exec(html)) !== null) {
        const rawUrl = match[1].replace(/&amp;/g, "&");
        const photoUrl = `https://mbasic.facebook.com${rawUrl}`;
        if (!seen.has(photoUrl)) {
            seen.add(photoUrl);
            photoLinks.push(photoUrl);
        }
    }

    // Also look for /USERNAME/photos/ links
    const photosPattern = /href=["'](\/[^"']+\/photos\/[^"']+)["']/gi;
    while ((match = photosPattern.exec(html)) !== null) {
        const rawUrl = match[1].replace(/&amp;/g, "&");
        const photoUrl = `https://mbasic.facebook.com${rawUrl}`;
        if (!seen.has(photoUrl)) {
            seen.add(photoUrl);
            photoLinks.push(photoUrl);
        }
    }

    console.log(`[fb-photo] mbasic: ${images.length} direct images, ${photoLinks.length} photo page links`);

    // Fetch each photo page for full-resolution images
    const BATCH_SIZE = 3;
    for (let i = 0; i < photoLinks.length; i += BATCH_SIZE) {
        const batch = photoLinks.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
            batch.map(async (pageUrl) => {
                try {
                    const { html: photoHtml } = await fetchFacebookPage(pageUrl, false);
                    const pageImages: string[] = [];

                    // Find images in the photo page
                    const imgSrcPattern = /<img[^>]+src=["'](https?:\/\/scontent[^"']+)["'][^>]*>/gi;
                    let m;
                    while ((m = imgSrcPattern.exec(photoHtml)) !== null) {
                        const decoded = decodeEscapedUrl(m[1]);
                        // Skip tiny profile pics
                        if (!decoded.includes("/p50x50/") && !decoded.includes("/p100x100/") &&
                            !decoded.includes("/s50x50/") && !decoded.includes("/s100x100/") &&
                            !decoded.includes("_s.")) {
                            pageImages.push(decoded);
                        }
                    }

                    // Look for "View Full Size" links
                    const fullSizePattern = /href=["'](\/photo\/view_full_size\/\?[^"']+)["']/gi;
                    while ((m = fullSizePattern.exec(photoHtml)) !== null) {
                        try {
                            const fullUrl = `https://mbasic.facebook.com${decodeEscapedUrl(m[1])}`;
                            const fullRes = await fetch(fullUrl, {
                                headers: { "User-Agent": USER_AGENT, "Accept": "text/html,image/*,*/*" },
                                redirect: "follow",
                            });
                            if (fullRes.ok) {
                                const ct = fullRes.headers.get("content-type") || "";
                                if (ct.startsWith("image/")) {
                                    pageImages.push(fullRes.url);
                                } else {
                                    const fullHtml = await fullRes.text();
                                    const directImgPattern = /<img[^>]+src=["'](https?:\/\/scontent[^"']+)["']/gi;
                                    while ((m = directImgPattern.exec(fullHtml)) !== null) {
                                        pageImages.push(decodeEscapedUrl(m[1]));
                                    }
                                }
                            }
                        } catch { /* ignore */ }
                    }

                    return pageImages;
                } catch {
                    return [];
                }
            })
        );

        for (const result of results) {
            if (result.status === "fulfilled") {
                for (const img of result.value) {
                    if (!images.includes(img)) images.push(img);
                }
            }
        }
    }

    return images;
}

/**
 * Extract title/description from the page
 */
function extractTitle(html: string): string {
    const ogTitle = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']*?)["']/i)
        || html.match(/<meta\s+content=["']([^"']*?)["']\s+(?:property|name)=["']og:title["']/i);
    if (ogTitle?.[1]) return decodeHTMLEntities(ogTitle[1]).slice(0, 200);

    const ogDesc = html.match(/<meta\s+(?:property|name)=["']og:description["']\s+content=["']([^"']*?)["']/i)
        || html.match(/<meta\s+content=["']([^"']*?)["']\s+(?:property|name)=["']og:description["']/i);
    if (ogDesc?.[1]) return decodeHTMLEntities(ogDesc[1]).slice(0, 200);

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) return decodeHTMLEntities(titleMatch[1]).slice(0, 200);

    return "Facebook Post";
}

function extractUploader(html: string): string {
    const authorMatch = html.match(/<meta\s+(?:property|name)=["'](?:author|article:author)["']\s+content=["']([^"']*?)["']/i)
        || html.match(/<meta\s+content=["']([^"']*?)["']\s+(?:property|name)=["'](?:author|article:author)["']/i);
    if (authorMatch?.[1]) return decodeHTMLEntities(authorMatch[1]);

    const ogTitle = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']*?)["']/i)
        || html.match(/<meta\s+content=["']([^"']*?)["']\s+(?:property|name)=["']og:title["']/i);
    if (ogTitle?.[1]) {
        const parts = ogTitle[1].split(/\s*[-–|]\s*/);
        if (parts.length > 1) return decodeHTMLEntities(parts[0]).trim();
    }

    // mbasic: author in <strong><a>Name</a></strong>
    const strongMatch = html.match(/<strong[^>]*><a[^>]*>([^<]+)<\/a><\/strong>/i);
    if (strongMatch?.[1]) return decodeHTMLEntities(strongMatch[1]);

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
 * Try to upgrade a Facebook CDN URL to the highest available resolution.
 *
 * Facebook CDN URLs have size constraints in the `stp` query parameter:
 *   - stp=dst-jpg_p526x296_tt6  → resized to 526x296
 *   - stp=cp0_dst-jpg_s50x50_tt6 → cropped to 50x50
 *   - stp=dst-jpg_tt6&cstp=mx1080x1920&ctp=p600x600 → constrained
 *
 * We attempt to fetch without size constraints. If that fails (403),
 * we fall back to the original URL.
 */
async function tryUpgradeResolution(imageUrl: string): Promise<string> {
    // If it's already a large image (no small size hint), keep as-is
    const sizeMatch = imageUrl.match(/(?:s|p)(\d+)x(\d+)/);
    if (sizeMatch) {
        const maxDim = Math.max(parseInt(sizeMatch[1]), parseInt(sizeMatch[2]));
        if (maxDim >= 960) return imageUrl; // Already high-res
    }
    if (!sizeMatch && !imageUrl.includes("cstp=") && !imageUrl.includes("ctp=")) {
        return imageUrl; // No size constraints
    }

    // Try removing size constraints
    const upgradedUrl = imageUrl
        .replace(/[?&]stp=[^&]*/, (match) => {
            // Keep stp but remove size hints: p526x296, s50x50, etc.
            const cleaned = match.replace(/_(?:p|s)\d+x\d+/g, "");
            return cleaned;
        })
        .replace(/[?&]cstp=[^&]*/g, "")
        .replace(/[?&]ctp=[^&]*/g, "")
        // Clean up double &&
        .replace(/&&+/g, "&")
        .replace(/\?&/, "?");

    if (upgradedUrl === imageUrl) return imageUrl;

    try {
        const res = await fetch(upgradedUrl, {
            method: "HEAD",
            headers: { "User-Agent": USER_AGENT, "Referer": "https://www.facebook.com/" },
        });
        if (res.ok) {
            console.log(`[fb-photo] Upgraded resolution: ${imageUrl.substring(0, 80)} → OK`);
            return upgradedUrl;
        }
    } catch { /* fall through to original */ }

    return imageUrl;
}

/**
 * Deduplicate images, keeping the highest resolution version of each unique photo.
 * Groups URLs by their base filename and picks the best from each group.
 */
function deduplicateImages(urls: string[]): string[] {
    if (urls.length <= 1) return urls;

    const groups = new Map<string, { url: string; score: number }[]>();

    for (const url of urls) {
        try {
            const parsed = new URL(url);
            const pathParts = parsed.pathname.split("/");
            const filename = pathParts[pathParts.length - 1] || "";
            // Group by filename without resolution suffix
            const baseKey = filename.replace(/_[a-z](?=\.)/i, "");

            if (!groups.has(baseKey)) groups.set(baseKey, []);

            // Score: higher = better resolution
            let score = 0;

            // Size hints in stp parameter
            const stpMatch = url.match(/stp=[^&]*/);
            if (stpMatch) {
                const stp = stpMatch[0];
                const dimMatch = stp.match(/(?:p|s)(\d+)x(\d+)/);
                if (dimMatch) {
                    score = parseInt(dimMatch[1]) * parseInt(dimMatch[2]);
                } else if (!stp.includes("_p") && !stp.includes("_s")) {
                    // No size constraint in stp = likely original → highest score
                    score = 10_000_000;
                }
            } else {
                // No stp parameter at all = original
                score = 10_000_000;
            }

            // cstp=mx1080x1920 means max 1080x1920
            const cstpMatch = url.match(/cstp=mx(\d+)x(\d+)/);
            if (cstpMatch) {
                score = Math.max(score, parseInt(cstpMatch[1]) * parseInt(cstpMatch[2]));
            }

            // _o suffix = original
            if (url.includes("_o.")) score = Math.max(score, 5_000_000);
            // _n suffix = normal
            if (url.includes("_n.")) score = Math.max(score, 1_000_000);

            groups.get(baseKey)!.push({ url, score });
        } catch {
            groups.set(url, [{ url, score: 0 }]);
        }
    }

    const result: string[] = [];
    for (const [, group] of groups) {
        const best = group.sort((a, b) => b.score - a.score)[0];
        result.push(best.url);
    }

    return result;
}

// ─── Main scraper ─────────────────────────────────────────────────────────────

export async function scrapeFacebookPhotos(url: string): Promise<MediaInfo> {
    console.log(`[fb-photo] Scraping photos from: ${url}`);

    let allImages: string[] = [];
    let title = "Facebook Post";
    let uploader = "Facebook User";
    let desktopHtml = "";

    // ── Strategy 1: Desktop page with full browser headers ──
    // This is the primary strategy. With proper sec-ch-ua headers,
    // Facebook returns a large page (~1.2MB) with embedded Relay data.
    try {
        console.log("[fb-photo] Strategy 1: Desktop page");
        const { html, finalUrl } = await fetchFacebookPage(url, false);
        desktopHtml = html;
        console.log(`[fb-photo] Desktop page: ${html.length} bytes, final URL: ${finalUrl}`);

        // Check for login wall
        // IMPORTANT: The full 1.2MB Facebook page ALWAYS includes "login_form"
        // in the header/sidebar — that does NOT mean it's a login-only page.
        // A real login wall is a small page (<50KB) with no og:image or scontent data.
        const hasOgImage = html.includes("og:image");
        const hasScontent = html.includes("scontent");
        const isSmallPage = html.length < 50000;
        const isLoginOnly = isSmallPage && !hasOgImage && !hasScontent && (
            html.includes("login_form") ||
            html.includes("You must log in")
        );

        if (isLoginOnly) {
            console.log("[fb-photo] Desktop page: login wall detected (small page with no content)");
        } else {
            // Extract images
            const ogImages = extractOgImages(html);
            const scriptImages = extractScriptImages(html);
            console.log(`[fb-photo] Desktop: ${ogImages.length} OG images, ${scriptImages.length} script images`);

            // Separate post photos from profile pics/avatars
            const postPhotos = scriptImages.filter(isPostPhoto);
            const ogPostPhotos = ogImages.filter(img => img.includes("scontent"));
            console.log(`[fb-photo] Desktop: ${postPhotos.length} post photos, ${ogPostPhotos.length} OG post photos`);

            // Add post photos first (from script data — these may have more photos on AWS)
            for (const img of postPhotos) {
                if (!allImages.includes(img)) allImages.push(img);
            }
            // Then OG images
            for (const img of ogPostPhotos) {
                if (!allImages.includes(img)) allImages.push(img);
            }

            // If we didn't find post-specific photos, add all non-tiny images
            if (allImages.length === 0) {
                for (const img of [...scriptImages, ...ogImages]) {
                    if (!allImages.includes(img) && isHighResFacebookImage(img)) {
                        allImages.push(img);
                    }
                }
            }

            title = extractTitle(html);
            uploader = extractUploader(html);
        }
    } catch (err) {
        console.error("[fb-photo] Desktop strategy failed:", err instanceof Error ? err.message : err);
    }

    // ── Strategy 2: mbasic.facebook.com ──
    // Only try if desktop didn't find enough photos.
    // NOTE: mbasic does NOT support pfbid URLs — they return error pages.
    if (allImages.length < 2 && !url.includes("pfbid")) {
        try {
            console.log("[fb-photo] Strategy 2: mbasic");
            const mbasicImages = await extractMbasicPhotos(url);
            console.log(`[fb-photo] mbasic: ${mbasicImages.length} images`);
            for (const img of mbasicImages) {
                if (!allImages.includes(img)) allImages.push(img);
            }
        } catch (err) {
            console.error("[fb-photo] mbasic strategy failed:", err instanceof Error ? err.message : err);
        }
    }

    // ── Strategy 3: Mobile page ──
    // Last resort. m.facebook.com sometimes has different CDN URLs.
    if (allImages.length === 0) {
        try {
            console.log("[fb-photo] Strategy 3: Mobile page");
            const mobileUrl = url.replace("www.facebook.com", "m.facebook.com");
            const { html: mobileHtml } = await fetchFacebookPage(mobileUrl, true);
            console.log(`[fb-photo] Mobile page: ${mobileHtml.length} bytes`);

            const ogImages = extractOgImages(mobileHtml);
            const scriptImages = extractScriptImages(mobileHtml);
            console.log(`[fb-photo] Mobile: ${ogImages.length} OG, ${scriptImages.length} script`);

            for (const img of [...scriptImages, ...ogImages]) {
                if (!allImages.includes(img) && isHighResFacebookImage(img)) {
                    allImages.push(img);
                }
            }

            if (title === "Facebook Post") title = extractTitle(mobileHtml);
            if (uploader === "Facebook User") uploader = extractUploader(mobileHtml);
        } catch (err) {
            console.error("[fb-photo] Mobile strategy failed:", err instanceof Error ? err.message : err);
        }
    }

    // ── Filter and deduplicate ──
    console.log(`[fb-photo] Total images before filtering: ${allImages.length}`);

    // Filter out very small images
    const filteredImages = allImages.filter(img => {
        if (!img.includes("fbcdn.net") && !img.includes("scontent")) return false;

        // Check for small size in stp parameter
        const stpMatch = img.match(/stp=[^&]*/);
        if (stpMatch) {
            const dimMatch = stpMatch[0].match(/(?:s|p)(\d+)x(\d+)/);
            if (dimMatch) {
                const maxDim = Math.max(parseInt(dimMatch[1]), parseInt(dimMatch[2]));
                if (maxDim < 150) return false; // Skip tiny thumbnails
            }
        }

        return true;
    });

    // Deduplicate
    const uniqueImages = deduplicateImages(filteredImages.length > 0 ? filteredImages : allImages);
    console.log(`[fb-photo] After dedup: ${uniqueImages.length} unique images`);

    // Try to upgrade resolution for each image
    const upgradedImages = await Promise.all(
        uniqueImages.map(img => tryUpgradeResolution(img))
    );

    console.log(`[fb-photo] Final: ${upgradedImages.length} images`);

    if (upgradedImages.length === 0) {
        throw new Error("NO_PHOTOS_FOUND");
    }

    // Build MediaItems
    const items: MediaItem[] = upgradedImages.map((imageUrl, index) => ({
        type: "photo" as const,
        title: upgradedImages.length > 1 ? `Photo ${index + 1}` : title,
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
