// /**
//  * Facebook Photo Scraper
//  *
//  * Extracts full-resolution photos from Facebook posts (including /share/p/ links).
//  *
//  * Architecture:
//  *   1. Try desktop page WITHOUT cookies (cleanest HTML, only has this post's data)
//  *   2. If login-walled → use mbasic.facebook.com WITH cookies
//  *      (mbasic is MUCH cleaner than the full desktop page — no news feed pollution)
//  *   3. Mobile page as last resort
//  *
//  * CRITICAL LESSON: When cookies are sent to www.facebook.com, the response
//  * includes the ENTIRE news feed, sidebar, and suggested posts — all containing
//  * scontent images. Parsing this page for post photos is unreliable.
//  * Instead, we use mbasic.facebook.com which returns ONLY the target post content.
//  *
//  * This module is ONLY for photos. Video/Reel downloads remain handled by yt-dlp.
//  */

import type { MediaInfo, MediaItem, Platform } from "./ytdlp";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MOBILE_USER_AGENT =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// ─── Cookie handling ──────────────────────────────────────────────────────────

function getFacebookCookies(): string {
    let cookieText = "";

    if (process.env.YTDLP_COOKIES) {
        try {
            cookieText = Buffer.from(process.env.YTDLP_COOKIES, "base64").toString("utf8");
        } catch {
            console.error("[fb-photo] Failed to decode YTDLP_COOKIES");
        }
    }

    if (!cookieText) {
        const cookiesFile = resolve(process.cwd(), "cookies.txt");
        if (existsSync(cookiesFile)) {
            cookieText = readFileSync(cookiesFile, "utf8");
        }
    }

    if (!cookieText) return "";

    const fbCookies: string[] = [];
    for (const line of cookieText.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#") || !trimmed) continue;

        const parts = trimmed.split("\t");
        if (parts.length >= 7) {
            const domain = parts[0];
            const name = parts[5];
            const value = parts[6];

            if (domain.includes("facebook.com") || domain.includes(".facebook.com")) {
                fbCookies.push(`${name}=${value}`);
            }
        }
    }

    const cookieHeader = fbCookies.join("; ");
    if (cookieHeader) {
        console.log(`[fb-photo] Found ${fbCookies.length} Facebook cookies`);
    }
    return cookieHeader;
}

let _cachedCookies: string | null = null;
function getCachedFacebookCookies(): string {
    if (_cachedCookies === null) {
        _cachedCookies = getFacebookCookies();
    }
    return _cachedCookies;
}

// ─── URL pattern helpers ──────────────────────────────────────────────────────

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

async function fetchPage(url: string, options: {
    mobile?: boolean;
    cookies?: string;
} = {}): Promise<{ html: string; finalUrl: string }> {
    const { mobile = false, cookies } = options;

    const headers: Record<string, string> = mobile ? {
        "User-Agent": MOBILE_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    } : {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "sec-ch-ua": '"Chromium";v="122", "Google Chrome";v="122"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    };

    if (cookies) {
        headers["Cookie"] = cookies;
    }

    const response = await fetch(url, { headers, redirect: "follow" });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const finalUrl = response.url;

    if (finalUrl.includes("/login/") || finalUrl.includes("login.php")) {
        throw new Error("LOGIN_REDIRECT");
    }

    return { html, finalUrl };
}

// ─── Utility functions ────────────────────────────────────────────────────────

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
 * Check if a URL is a post photo (not a profile pic, emoji, or UI element).
 */
function isPostPhoto(url: string): boolean {
    if (!url.includes("scontent") && !url.includes("fbcdn.net")) return false;
    if (url.includes("emoji") || url.includes("reaction")) return false;
    if (url.includes("/rsrc.php/")) return false;
    if (url.includes("static.xx.fbcdn.net/rsrc")) return false;
    if (url.includes("external") && url.includes("fbcdn.net")) return false;

    // Profile pic patterns
    if (url.includes("t39.30808-1/")) return false;
    if (url.includes("t1.30497-1/")) return false;
    if (url.includes("t1.6435-1/")) return false;
    if (url.includes("t39.30808-0/")) return false;

    // Skip tiny sizes
    const stpMatch = url.match(/stp=[^&]*/);
    if (stpMatch) {
        const dimMatch = stpMatch[0].match(/(?:s|p)(\d+)x(\d+)/);
        if (dimMatch) {
            const maxDim = Math.max(parseInt(dimMatch[1]), parseInt(dimMatch[2]));
            if (maxDim < 100) return false;
        }
    }

    // Post photos use t39.30808-6
    if (url.includes("t39.30808-6/")) return true;

    return false;
}

/**
 * Extract the unique fingerprint from a Facebook CDN URL for deduplication.
 * Two different photos always have different numeric ID sequences.
 * Same photo at different resolutions shares the same IDs.
 */
function getPhotoFingerprint(url: string): string {
    try {
        const parsed = new URL(url);
        const pathParts = parsed.pathname.split("/");
        const filename = pathParts[pathParts.length - 1] || "";

        // Extract the unique numeric ID sequence: "123456789_12345678901234_1234567890123456789_n.jpg"
        const idMatch = filename.match(/(\d{5,}_\d{5,})/);
        if (idMatch) return idMatch[1];

        return filename.replace(/\.[^.]+$/, "");
    } catch {
        return url;
    }
}

/**
 * Deduplicate images by photo fingerprint, keeping highest resolution.
 */
function deduplicateImages(urls: string[]): string[] {
    if (urls.length <= 1) return urls;

    const groups = new Map<string, { url: string; score: number }[]>();

    for (const url of urls) {
        const fingerprint = getPhotoFingerprint(url);
        if (!groups.has(fingerprint)) groups.set(fingerprint, []);

        let score = 0;
        const stpMatch = url.match(/stp=[^&]*/);
        if (stpMatch) {
            const dimMatch = stpMatch[0].match(/(?:p|s)(\d+)x(\d+)/);
            if (dimMatch) {
                score = parseInt(dimMatch[1]) * parseInt(dimMatch[2]);
            } else if (!stpMatch[0].includes("_p") && !stpMatch[0].includes("_s")) {
                score = 10_000_000;
            }
        } else {
            score = 10_000_000;
        }
        if (url.includes("_o.")) score = Math.max(score, 5_000_000);
        if (url.includes("_n.")) score = Math.max(score, 1_000_000);

        groups.get(fingerprint)!.push({ url, score });
    }

    const result: string[] = [];
    for (const [, group] of groups) {
        const best = group.sort((a, b) => b.score - a.score)[0];
        result.push(best.url);
    }

    return result;
}

/**
 * Try to upgrade a Facebook CDN URL to higher resolution.
 */
async function tryUpgradeResolution(imageUrl: string): Promise<string> {
    const sizeMatch = imageUrl.match(/(?:s|p)(\d+)x(\d+)/);
    if (sizeMatch) {
        const maxDim = Math.max(parseInt(sizeMatch[1]), parseInt(sizeMatch[2]));
        if (maxDim >= 960) return imageUrl;
    }
    if (!sizeMatch && !imageUrl.includes("cstp=") && !imageUrl.includes("ctp=")) {
        return imageUrl;
    }

    const upgradedUrl = imageUrl
        .replace(/[?&]stp=[^&]*/, (match) => match.replace(/_(?:p|s)\d+x\d+/g, ""))
        .replace(/[?&]cstp=[^&]*/g, "")
        .replace(/[?&]ctp=[^&]*/g, "")
        .replace(/&&+/g, "&")
        .replace(/\?&/, "?");

    if (upgradedUrl === imageUrl) return imageUrl;

    try {
        const res = await fetch(upgradedUrl, {
            method: "HEAD",
            headers: { "User-Agent": USER_AGENT, "Referer": "https://www.facebook.com/" },
        });
        if (res.ok) return upgradedUrl;
    } catch { /* fall through */ }

    return imageUrl;
}

// ─── OG Image extraction ─────────────────────────────────────────────────────

function extractOgImages(html: string): string[] {
    const images: string[] = [];
    const patterns = [
        /<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/gi,
        /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/gi,
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

// ─── Title / Uploader extraction ──────────────────────────────────────────────

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

    const strongMatch = html.match(/<strong[^>]*><a[^>]*>([^<]+)<\/a><\/strong>/i);
    if (strongMatch?.[1]) return decodeHTMLEntities(strongMatch[1]);

    return "Facebook User";
}

// ─── Subattachment extraction (for public pages) ─────────────────────────────

function extractSubattachmentImages(html: string): string[] {
    const images: string[] = [];
    const seen = new Set<string>();
    let match;

    // Strategy 1: subattachments/all_subattachments nodes
    const subPattern = /"(?:sub_?attachments|all_sub_?attachments)"\s*:\s*\{"(?:nodes|edges)"\s*:\s*\[([\s\S]*?)\]\s*\}/gi;
    while ((match = subPattern.exec(html)) !== null) {
        const block = match[1];
        const uriPattern = /"uri"\s*:\s*"(https?:[^"]+scontent[^"]+)"/gi;
        let uriMatch;
        while ((uriMatch = uriPattern.exec(block)) !== null) {
            const decoded = decodeEscapedUrl(uriMatch[1]);
            if (!seen.has(decoded) && isPostPhoto(decoded)) {
                seen.add(decoded);
                images.push(decoded);
            }
        }
    }

    // Strategy 2: media image URIs with dimensions
    const mediaPattern = /"media"\s*:\s*\{[^}]*?"image"\s*:\s*\{[^}]*?"uri"\s*:\s*"(https?:[^"]+scontent[^"]+)"[^}]*?"(?:width|height)"\s*:\s*(\d+)/gi;
    while ((match = mediaPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        const dim = parseInt(match[2]);
        if (dim > 100 && !seen.has(decoded) && isPostPhoto(decoded)) {
            seen.add(decoded);
            images.push(decoded);
        }
    }

    // Strategy 3: photo_image objects
    const photoImagePattern = /"photo_image"\s*:\s*\{"uri"\s*:\s*"(https?:[^"]+scontent[^"]+)"/gi;
    while ((match = photoImagePattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        if (!seen.has(decoded) && isPostPhoto(decoded)) {
            seen.add(decoded);
            images.push(decoded);
        }
    }

    // Strategy 4: viewer_image / large image patterns
    const viewerPattern = /"(?:viewer_image|large_share_image|full_image|attached_photo)"\s*:\s*\{[^}]*?"uri"\s*:\s*"(https?:[^"]+scontent[^"]+)"/gi;
    while ((match = viewerPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        if (!seen.has(decoded) && isPostPhoto(decoded)) {
            seen.add(decoded);
            images.push(decoded);
        }
    }

    console.log(`[fb-photo] Subattachment extraction: ${images.length} photos`);
    return images;
}

/**
 * Targeted URI extraction from JSON fields — used only for unauthenticated pages.
 */
function extractScriptImages(html: string): string[] {
    const images: string[] = [];
    const seen = new Set<string>();
    let match;

    const uriPattern = /"(?:uri|image_uri|photo_image|viewer_image|image\.uri|large_share_image|baseUrl)"\s*:\s*"(https?:[^"]+scontent[^"]+)"/gi;
    while ((match = uriPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        if (!seen.has(decoded) && isPostPhoto(decoded)) {
            seen.add(decoded);
            images.push(decoded);
        }
    }

    const plainPattern = /(?:content|href)=["'](https?:\/\/scontent[^"'\s<>\\]+)["']/gi;
    while ((match = plainPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        if (!seen.has(decoded) && isPostPhoto(decoded)) {
            seen.add(decoded);
            images.push(decoded);
        }
    }

    return images;
}

// ─── Resolve pfbid/share URLs ─────────────────────────────────────────────────

/**
 * Resolve a Facebook URL (especially pfbid and /share/p/ URLs) to get the
 * canonical post URL and any photo page links.
 *
 * This is CRITICAL because mbasic.facebook.com doesn't support pfbid URLs.
 * We follow redirects to find the real post URL.
 */
async function resolveUrl(url: string, cookies: string): Promise<string> {
    // If it's already a standard URL, no resolution needed
    if (!url.includes("pfbid") && !url.includes("/share/")) {
        return url;
    }

    console.log(`[fb-photo] Resolving URL: ${url.substring(0, 80)}`);

    try {
        // Fetch the URL with cookies (follow redirects) to get the canonical URL
        const headers: Record<string, string> = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html",
        };
        if (cookies) headers["Cookie"] = cookies;

        const response = await fetch(url, { headers, redirect: "follow" });
        const finalUrl = response.url;
        const html = await response.text();

        console.log(`[fb-photo] Resolved to: ${finalUrl.substring(0, 100)}`);

        // Try to extract permalink from the page
        // Facebook sometimes puts the canonical URL in the page
        const permalinkMatch = html.match(/"permalink_url"\s*:\s*"(https?:[^"]+)"/);
        if (permalinkMatch) {
            const permalink = decodeEscapedUrl(permalinkMatch[1]);
            console.log(`[fb-photo] Found permalink: ${permalink.substring(0, 100)}`);
            return permalink;
        }

        // Try to get story_fbid + id for constructing a mbasic URL
        const storyFbidMatch = html.match(/"story_fbid"\s*:\s*"?(\d+)/);
        const ownerIdMatch = html.match(/"(?:owner_id|actor_id|page_id)"\s*:\s*"?(\d+)/);
        if (storyFbidMatch && ownerIdMatch) {
            const mbasicUrl = `https://mbasic.facebook.com/story.php?story_fbid=${storyFbidMatch[1]}&id=${ownerIdMatch[1]}`;
            console.log(`[fb-photo] Constructed mbasic URL: ${mbasicUrl}`);
            return mbasicUrl;
        }

        // If we got a redirect to a regular URL, use it
        if (!finalUrl.includes("pfbid") && !finalUrl.includes("/share/")) {
            return finalUrl;
        }

        // Try extracting photo fbids from the page for direct access
        const fbidMatches = html.match(/photo\.php\?fbid=(\d+)/g);
        if (fbidMatches && fbidMatches.length > 0) {
            // Return the first photo page — the mbasic extractor will find siblings
            const fbid = fbidMatches[0].match(/fbid=(\d+)/)?.[1];
            if (fbid) {
                return `https://mbasic.facebook.com/photo.php?fbid=${fbid}`;
            }
        }

        return finalUrl;
    } catch (err) {
        console.error("[fb-photo] URL resolution failed:", err instanceof Error ? err.message : err);
        return url;
    }
}

// ─── mbasic photo extraction ─────────────────────────────────────────────────

/**
 * Extract photos via mbasic.facebook.com.
 *
 * mbasic is the BEST source for multi-photo posts because:
 *   - Returns clean HTML with just the post content (no news feed, no sidebar)
 *   - Each photo is linked as a separate page with a full-res version
 *   - Works even from server IPs (AWS, etc.)
 *
 * Strategy:
 *   1. Fetch the post page from mbasic
 *   2. Find all photo page links (photo.php?fbid=...)
 *   3. Fetch each photo page individually to get full-res images
 */
async function extractMbasicPhotos(url: string, cookies: string): Promise<{
    images: string[];
    title: string;
    uploader: string;
}> {
    const result = { images: [] as string[], title: "Facebook Post", uploader: "Facebook User" };

    // Convert URL to mbasic
    let mbasicUrl = url
        .replace(/^https?:\/\/(www\.)?facebook\.com/, "https://mbasic.facebook.com")
        .replace(/^https?:\/\/m\.facebook\.com/, "https://mbasic.facebook.com");

    // If URL has pfbid, resolve it first
    if (url.includes("pfbid") || url.includes("/share/")) {
        const resolvedUrl = await resolveUrl(url, cookies);
        mbasicUrl = resolvedUrl
            .replace(/^https?:\/\/(www\.)?facebook\.com/, "https://mbasic.facebook.com")
            .replace(/^https?:\/\/m\.facebook\.com/, "https://mbasic.facebook.com");
        console.log(`[fb-photo] mbasic URL after resolution: ${mbasicUrl.substring(0, 100)}`);
    }

    console.log(`[fb-photo] mbasic: fetching ${mbasicUrl.substring(0, 100)}`);

    const headers: Record<string, string> = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    };
    if (cookies) headers["Cookie"] = cookies;

    const response = await fetch(mbasicUrl, { headers, redirect: "follow" });
    if (!response.ok) throw new Error(`mbasic returned ${response.status}`);
    const html = await response.text();
    console.log(`[fb-photo] mbasic: ${html.length} bytes`);

    // Check for error/login page
    if (html.includes("went wrong") || html.includes("Back to Home") || html.length < 5000) {
        console.log("[fb-photo] mbasic: error page or too small");
        return result;
    }
    if (html.includes("login_form") && html.length < 20000) {
        console.log("[fb-photo] mbasic: login wall");
        return result;
    }

    // Extract title/uploader from mbasic HTML
    result.title = extractTitle(html);
    result.uploader = extractUploader(html);

    // ── Step 1: Find ALL photo page links ──
    // These are links to individual photo pages like /photo.php?fbid=12345&...
    const photoLinks: string[] = [];
    const seenLinks = new Set<string>();
    let match;

    // Pattern 1: /photo.php?fbid=...
    const fbidPattern = /href=["'](\/photo\.php\?fbid=\d+[^"']*)["']/gi;
    while ((match = fbidPattern.exec(html)) !== null) {
        const rawUrl = match[1].replace(/&amp;/g, "&");
        if (!seenLinks.has(rawUrl)) {
            seenLinks.add(rawUrl);
            photoLinks.push(`https://mbasic.facebook.com${rawUrl}`);
        }
    }

    // Pattern 2: /USERNAME/photos/...
    const photosLinkPattern = /href=["'](\/[^"']+\/photos\/[^"']+)["']/gi;
    while ((match = photosLinkPattern.exec(html)) !== null) {
        const rawUrl = match[1].replace(/&amp;/g, "&");
        if (!seenLinks.has(rawUrl)) {
            seenLinks.add(rawUrl);
            photoLinks.push(`https://mbasic.facebook.com${rawUrl}`);
        }
    }

    console.log(`[fb-photo] mbasic: found ${photoLinks.length} photo page links`);

    // ── Step 2: Also grab any direct <img> scontent URLs from the post page ──
    const directImages: string[] = [];
    const imgPattern = /<img[^>]+src=["'](https?:\/\/scontent[^"']+)["'][^>]*>/gi;
    while ((match = imgPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        // Skip small profile pics and icons
        if (decoded.includes("/p50x50/") || decoded.includes("/p100x100/") ||
            decoded.includes("/s50x50/") || decoded.includes("/s100x100/") ||
            decoded.includes("_s.") || decoded.includes("/cp0_")) {
            continue;
        }
        const stpMatch = decoded.match(/stp=[^&]*/);
        if (stpMatch) {
            const dimMatch = stpMatch[0].match(/(?:s|p)(\d+)x(\d+)/);
            if (dimMatch) {
                const maxDim = Math.max(parseInt(dimMatch[1]), parseInt(dimMatch[2]));
                if (maxDim < 100) continue;
            }
        }
        directImages.push(decoded);
    }

    console.log(`[fb-photo] mbasic: ${directImages.length} direct images on post page`);

    // ── Step 3: Fetch each photo page for full-resolution images ──
    if (photoLinks.length > 0) {
        const BATCH_SIZE = 3;
        for (let i = 0; i < photoLinks.length; i += BATCH_SIZE) {
            const batch = photoLinks.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
                batch.map(async (pageUrl) => {
                    try {
                        const pageHeaders: Record<string, string> = {
                            "User-Agent": USER_AGENT,
                            "Accept": "text/html,application/xhtml+xml",
                        };
                        if (cookies) pageHeaders["Cookie"] = cookies;

                        const res = await fetch(pageUrl, { headers: pageHeaders, redirect: "follow" });
                        if (!res.ok) return [];
                        const photoHtml = await res.text();

                        const pageImages: string[] = [];

                        // Get scontent images from the photo page (skip tiny ones)
                        const pageImgPattern = /<img[^>]+src=["'](https?:\/\/scontent[^"']+)["'][^>]*>/gi;
                        let m;
                        while ((m = pageImgPattern.exec(photoHtml)) !== null) {
                            const decoded = decodeEscapedUrl(m[1]);
                            if (!decoded.includes("/p50x50/") && !decoded.includes("/p100x100/") &&
                                !decoded.includes("/s50x50/") && !decoded.includes("/s100x100/") &&
                                !decoded.includes("_s.")) {
                                pageImages.push(decoded);
                            }
                        }

                        // Also try "View Full Size" links
                        const fullSizePattern = /href=["'](\/photo\/view_full_size\/\?[^"']+)["']/gi;
                        while ((m = fullSizePattern.exec(photoHtml)) !== null) {
                            try {
                                const fullUrl = `https://mbasic.facebook.com${decodeEscapedUrl(m[1])}`;
                                const fullHeaders: Record<string, string> = {
                                    "User-Agent": USER_AGENT,
                                    "Accept": "text/html,image/*,*/*",
                                };
                                if (cookies) fullHeaders["Cookie"] = cookies;

                                const fullRes = await fetch(fullUrl, { headers: fullHeaders, redirect: "follow" });
                                if (fullRes.ok) {
                                    const ct = fullRes.headers.get("content-type") || "";
                                    if (ct.startsWith("image/")) {
                                        pageImages.push(fullRes.url);
                                    } else {
                                        const fullHtml = await fullRes.text();
                                        const directPattern = /<img[^>]+src=["'](https?:\/\/scontent[^"']+)["']/gi;
                                        while ((m = directPattern.exec(fullHtml)) !== null) {
                                            pageImages.push(decodeEscapedUrl(m[1]));
                                        }
                                    }
                                }
                            } catch { /* ignore */ }
                        }

                        // Return the LARGEST image from this photo page
                        // (the photo page usually has the post photo + smaller profile pics)
                        if (pageImages.length > 0) {
                            // Pick the image that's most likely the full photo (largest URL, most params)
                            const bestImage = pageImages.reduce((best, img) => {
                                // Prefer images without small size indicators
                                const bestHasSize = /(?:s|p)\d+x\d+/.test(best);
                                const imgHasSize = /(?:s|p)\d+x\d+/.test(img);
                                if (!imgHasSize && bestHasSize) return img;
                                if (imgHasSize && !bestHasSize) return best;
                                // Prefer longer URLs (they tend to have more CDN params = original)
                                return img.length > best.length ? img : best;
                            });
                            return [bestImage];
                        }

                        return pageImages;
                    } catch {
                        return [];
                    }
                })
            );

            for (const res of results) {
                if (res.status === "fulfilled") {
                    for (const img of res.value) {
                        if (!result.images.includes(img)) {
                            result.images.push(img);
                        }
                    }
                }
            }
        }
    }

    // If no individual photo pages were found, use the direct images from the post page
    if (result.images.length === 0 && directImages.length > 0) {
        result.images = directImages;
    }

    console.log(`[fb-photo] mbasic total: ${result.images.length} photos`);
    return result;
}

// ─── Main scraper ─────────────────────────────────────────────────────────────

export async function scrapeFacebookPhotos(url: string): Promise<MediaInfo> {
    console.log(`[fb-photo] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[fb-photo] Scraping: ${url}`);

    const cookies = getCachedFacebookCookies();
    let allImages: string[] = [];
    let title = "Facebook Post";
    let uploader = "Facebook User";

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STRATEGY 1: Desktop page WITHOUT cookies (cleanest — public posts)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let needsAuth = false;
    try {
        console.log("[fb-photo] Strategy 1: Desktop page (no cookies)");
        const { html } = await fetchPage(url, {});
        console.log(`[fb-photo] Desktop page: ${html.length} bytes`);

        // Check for login wall
        const hasContent = html.includes("og:image") || html.includes("scontent");
        const isLoginWall = html.length < 50000 && !hasContent && (
            html.includes("login_form") || html.includes("You must log in")
        );

        if (isLoginWall) {
            console.log("[fb-photo] Desktop page: login wall → needs auth");
            needsAuth = true;
        } else {
            // Extract images from the clean page
            const subImages = extractSubattachmentImages(html);
            const ogImages = extractOgImages(html).filter(img => img.includes("scontent"));

            if (subImages.length > 0) {
                // Subattachment data found — most reliable
                for (const img of subImages) {
                    if (!allImages.includes(img)) allImages.push(img);
                }
                for (const img of ogImages) {
                    if (!allImages.includes(img)) allImages.push(img);
                }
                console.log(`[fb-photo] Desktop: ${subImages.length} subattachment + ${ogImages.length} OG`);
            } else {
                // No subattachment data — use script extraction (safe on unauthenticated pages)
                const scriptImages = extractScriptImages(html);
                for (const img of ogImages) {
                    if (!allImages.includes(img)) allImages.push(img);
                }
                for (const img of scriptImages) {
                    if (!allImages.includes(img)) allImages.push(img);
                }
                console.log(`[fb-photo] Desktop: ${ogImages.length} OG + ${scriptImages.length} script`);
            }

            title = extractTitle(html);
            uploader = extractUploader(html);
        }
    } catch (err) {
        if (err instanceof Error && err.message === "LOGIN_REDIRECT") {
            console.log("[fb-photo] Login redirect → needs auth");
            needsAuth = true;
        } else {
            console.error("[fb-photo] Desktop strategy failed:", err instanceof Error ? err.message : err);
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STRATEGY 2: mbasic.facebook.com WITH cookies
    //
    // Used when:
    //   a) Post requires authentication (login redirect / private post)
    //   b) Strategy 1 found fewer than 2 photos (might be incomplete)
    //
    // WHY mbasic instead of www with cookies?
    //   www.facebook.com with cookies returns the ENTIRE news feed,
    //   sidebar, and suggested posts — all full of scontent images.
    //   This causes random/unrelated photos to appear.
    //
    //   mbasic.facebook.com returns ONLY the target post content.
    //   Clean, simple HTML with no news feed pollution.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if ((needsAuth || allImages.length < 2) && cookies) {
        try {
            console.log(`[fb-photo] Strategy 2: mbasic with cookies (needsAuth=${needsAuth}, currentPhotos=${allImages.length})`);
            const mbasicResult = await extractMbasicPhotos(url, cookies);

            if (mbasicResult.images.length > 0) {
                if (needsAuth) {
                    // Auth was required — mbasic results are primary, replace any desktop results
                    allImages = mbasicResult.images;
                    console.log(`[fb-photo] mbasic (primary): ${mbasicResult.images.length} photos`);
                } else {
                    // Desktop found some photos but mbasic might have more
                    // Merge, preferring mbasic images
                    for (const img of mbasicResult.images) {
                        if (!allImages.includes(img)) allImages.push(img);
                    }
                    console.log(`[fb-photo] mbasic (supplement): total now ${allImages.length} photos`);
                }

                if (title === "Facebook Post") title = mbasicResult.title;
                if (uploader === "Facebook User") uploader = mbasicResult.uploader;
            }
        } catch (err) {
            console.error("[fb-photo] mbasic strategy failed:", err instanceof Error ? err.message : err);
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STRATEGY 3: Mobile page (last resort)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (allImages.length === 0) {
        try {
            console.log("[fb-photo] Strategy 3: Mobile page");
            const mobileUrl = url.replace("www.facebook.com", "m.facebook.com");
            const { html: mobileHtml } = await fetchPage(mobileUrl, {
                mobile: true,
                cookies: cookies || undefined,
            });
            console.log(`[fb-photo] Mobile page: ${mobileHtml.length} bytes`);

            const ogImages = extractOgImages(mobileHtml);
            const scriptImages = extractScriptImages(mobileHtml);
            console.log(`[fb-photo] Mobile: ${ogImages.length} OG, ${scriptImages.length} script`);

            for (const img of [...ogImages, ...scriptImages]) {
                if (!allImages.includes(img)) {
                    allImages.push(img);
                }
            }

            if (title === "Facebook Post") title = extractTitle(mobileHtml);
            if (uploader === "Facebook User") uploader = extractUploader(mobileHtml);
        } catch (err) {
            console.error("[fb-photo] Mobile strategy failed:", err instanceof Error ? err.message : err);
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Filter, deduplicate, and upgrade
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log(`[fb-photo] Total before filtering: ${allImages.length}`);

    // Filter out tiny images
    const filtered = allImages.filter(img => {
        if (!img.includes("fbcdn.net") && !img.includes("scontent")) return false;
        const stpMatch = img.match(/stp=[^&]*/);
        if (stpMatch) {
            const dimMatch = stpMatch[0].match(/(?:s|p)(\d+)x(\d+)/);
            if (dimMatch) {
                const maxDim = Math.max(parseInt(dimMatch[1]), parseInt(dimMatch[2]));
                if (maxDim < 150) return false;
            }
        }
        return true;
    });

    // Deduplicate
    const unique = deduplicateImages(filtered.length > 0 ? filtered : allImages);
    console.log(`[fb-photo] After dedup: ${unique.length} unique photos`);

    // Upgrade resolution
    const upgraded = await Promise.all(unique.map(img => tryUpgradeResolution(img)));

    console.log(`[fb-photo] Final: ${upgraded.length} photos`);

    if (upgraded.length === 0) {
        throw new Error("NO_PHOTOS_FOUND");
    }

    // Build MediaItems
    const items: MediaItem[] = upgraded.map((imageUrl, index) => ({
        type: "photo" as const,
        title: upgraded.length > 1 ? `Photo ${index + 1}` : title,
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
/**
 * Facebook Photo Scraper — v2
 *
 * Key fixes over v1:
 *  1. Multi-photo (carousel) posts: uses multiple targeted JSON extraction
 *     strategies that parse Facebook's Relay/Comet data more precisely.
 *  2. No random photos: strictly scoped to the post being fetched — never
 *     pulls from news feed, sidebar, or suggested posts.
 *  3. Better dedup: groups by numeric fbid rather than CDN filename so
 *     different-resolution copies of the same photo collapse correctly.
 *  4. GraphQL endpoint: tries /api/graphql/ with the post's fbid as a
 *     last-resort API call to retrieve all attachment photos.
 */

/**
 * Facebook Photo Scraper — v2
 *
 * Key fixes over v1:
 *  1. Multi-photo (carousel) posts: uses multiple targeted JSON extraction
 *     strategies that parse Facebook's Relay/Comet data more precisely.
 *  2. No random photos: strictly scoped to the post being fetched — never
 *     pulls from news feed, sidebar, or suggested posts.
 *  3. Better dedup: groups by numeric fbid rather than CDN filename so
 *     different-resolution copies of the same photo collapse correctly.
 *  4. GraphQL endpoint: tries /api/graphql/ with the post's fbid as a
 *     last-resort API call to retrieve all attachment photos.
 */

/**
 * Facebook Photo Scraper — v2
 *
 * Key fixes over v1:
 *  1. Multi-photo (carousel) posts: uses multiple targeted JSON extraction
 *     strategies that parse Facebook's Relay/Comet data more precisely.
 *  2. No random photos: strictly scoped to the post being fetched — never
 *     pulls from news feed, sidebar, or suggested posts.
 *  3. Better dedup: groups by numeric fbid rather than CDN filename so
 *     different-resolution copies of the same photo collapse correctly.
 *  4. GraphQL endpoint: tries /api/graphql/ with the post's fbid as a
 *     last-resort API call to retrieve all attachment photos.
 */