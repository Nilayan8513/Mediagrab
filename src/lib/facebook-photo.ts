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

    if (finalUrl.includes("/login/") || finalUrl.includes("login.php") || finalUrl.includes("/login?")) {
        throw new Error(`LOGIN_REDIRECT:${finalUrl}`);
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
 * RELAXED: we only filter out obvious non-post images.
 */
function isPostPhoto(url: string): boolean {
    if (!url.includes("scontent") && !url.includes("fbcdn.net")) return false;
    if (url.includes("emoji") || url.includes("reaction")) return false;
    if (url.includes("/rsrc.php/")) return false;
    if (url.includes("static.xx.fbcdn.net/rsrc")) return false;

    // Profile pic patterns (these specific CDN paths are always profile pics)
    if (url.includes("t39.30808-1/")) return false;
    if (url.includes("t1.30497-1/")) return false;
    if (url.includes("t1.6435-1/")) return false;
    if (url.includes("t39.30808-0/")) return false;

    // Skip tiny sizes only (< 80px)
    const stpMatch = url.match(/stp=[^&]*/);
    if (stpMatch) {
        const dimMatch = stpMatch[0].match(/(?:s|p)(\d+)x(\d+)/);
        if (dimMatch) {
            const maxDim = Math.max(parseInt(dimMatch[1]), parseInt(dimMatch[2]));
            if (maxDim < 80) return false;
        }
    }

    // Accept all scontent/fbcdn URLs that pass the above filters
    return true;
}

/**
 * Extract the unique fingerprint from a Facebook CDN URL for deduplication.
 */
function getPhotoFingerprint(url: string): string {
    try {
        const parsed = new URL(url);
        const pathParts = parsed.pathname.split("/");
        const filename = pathParts[pathParts.length - 1] || "";

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

    const mediaPattern = /"media"\s*:\s*\{[^}]*?"image"\s*:\s*\{[^}]*?"uri"\s*:\s*"(https?:[^"]+scontent[^"]+)"[^}]*?"(?:width|height)"\s*:\s*(\d+)/gi;
    while ((match = mediaPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        const dim = parseInt(match[2]);
        if (dim > 100 && !seen.has(decoded) && isPostPhoto(decoded)) {
            seen.add(decoded);
            images.push(decoded);
        }
    }

    const photoImagePattern = /"photo_image"\s*:\s*\{"uri"\s*:\s*"(https?:[^"]+scontent[^"]+)"/gi;
    while ((match = photoImagePattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        if (!seen.has(decoded) && isPostPhoto(decoded)) {
            seen.add(decoded);
            images.push(decoded);
        }
    }

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

function extractIdsFromLoginRedirect(loginUrl: string): { storyFbid: string; ownerId: string } | null {
    try {
        const parsed = new URL(loginUrl);
        const nextParam = parsed.searchParams.get("next");
        if (!nextParam) return null;

        const decodedNext = decodeURIComponent(nextParam);
        console.log(`[fb-photo] Login redirect 'next' param: ${decodedNext.substring(0, 120)}`);

        const nextUrl = new URL(decodedNext);
        const storyFbid = nextUrl.searchParams.get("story_fbid");
        const ownerId = nextUrl.searchParams.get("id");

        if (storyFbid && ownerId) {
            return { storyFbid, ownerId };
        }

        const fbidMatch = decodedNext.match(/story_fbid[=:](\d+)/);
        const idMatch = decodedNext.match(/[?&]id[=:](\d+)/);
        if (fbidMatch && idMatch) {
            return { storyFbid: fbidMatch[1], ownerId: idMatch[1] };
        }

        return null;
    } catch {
        return null;
    }
}

function isLoginUrl(url: string): boolean {
    return url.includes("/login/") || url.includes("login.php") || url.includes("/login?");
}

async function resolveUrl(url: string, cookies: string): Promise<string> {
    if (!url.includes("pfbid") && !url.includes("/share/")) {
        return url;
    }

    console.log(`[fb-photo] Resolving URL: ${url.substring(0, 80)}`);

    // Attempt 1: No cookies
    try {
        const headers: Record<string, string> = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html",
        };

        const response = await fetch(url, { headers, redirect: "follow" });
        const finalUrl = response.url;
        const html = await response.text();

        console.log(`[fb-photo] Resolved (no cookies) to: ${finalUrl.substring(0, 120)}`);

        if (isLoginUrl(finalUrl)) {
            console.log(`[fb-photo] Got login redirect, extracting story IDs from URL`);
            const ids = extractIdsFromLoginRedirect(finalUrl);
            if (ids) {
                const mbasicUrl = `https://mbasic.facebook.com/story.php?story_fbid=${ids.storyFbid}&id=${ids.ownerId}`;
                console.log(`[fb-photo] Extracted mbasic URL from login redirect: ${mbasicUrl}`);
                return mbasicUrl;
            }
        } else {
            return extractResolvedUrl(html, finalUrl, url);
        }
    } catch (err) {
        console.error("[fb-photo] Resolve attempt 1 failed:", err instanceof Error ? err.message : err);
    }

    // Attempt 2: With cookies
    if (cookies) {
        try {
            console.log(`[fb-photo] Resolving with cookies`);
            const headers: Record<string, string> = {
                "User-Agent": USER_AGENT,
                "Accept": "text/html",
                "Cookie": cookies,
            };

            const response = await fetch(url, { headers, redirect: "follow" });
            const finalUrl = response.url;
            const html = await response.text();

            console.log(`[fb-photo] Resolved (with cookies) to: ${finalUrl.substring(0, 120)}`);

            if (isLoginUrl(finalUrl)) {
                const ids = extractIdsFromLoginRedirect(finalUrl);
                if (ids) {
                    const mbasicUrl = `https://mbasic.facebook.com/story.php?story_fbid=${ids.storyFbid}&id=${ids.ownerId}`;
                    return mbasicUrl;
                }
            } else {
                return extractResolvedUrl(html, finalUrl, url);
            }
        } catch (err) {
            console.error("[fb-photo] Resolve attempt 2 failed:", err instanceof Error ? err.message : err);
        }
    }

    // Attempt 3: Try mbasic directly
    try {
        const mbasicShareUrl = url
            .replace(/^https?:\/\/(www\.)?facebook\.com/, "https://mbasic.facebook.com")
            .replace(/^https?:\/\/m\.facebook\.com/, "https://mbasic.facebook.com");
        console.log(`[fb-photo] Trying mbasic direct: ${mbasicShareUrl.substring(0, 100)}`);

        const headers: Record<string, string> = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html",
        };
        if (cookies) headers["Cookie"] = cookies;

        const response = await fetch(mbasicShareUrl, { headers, redirect: "follow" });
        const finalUrl = response.url;
        const html = await response.text();

        console.log(`[fb-photo] mbasic direct resolved to: ${finalUrl.substring(0, 120)}`);

        if (!isLoginUrl(finalUrl) && html.length > 5000) {
            const fbidMatches = html.match(/photo\.php\?fbid=(\d+)/g);
            if (fbidMatches && fbidMatches.length > 0) {
                const fbid = fbidMatches[0].match(/fbid=(\d+)/)?.[1];
                if (fbid) {
                    console.log(`[fb-photo] Found photo fbid from mbasic: ${fbid}`);
                    return `https://mbasic.facebook.com/photo.php?fbid=${fbid}`;
                }
            }
            if (!finalUrl.includes("/share/") && !finalUrl.includes("pfbid")) {
                return finalUrl;
            }
            return mbasicShareUrl;
        } else if (isLoginUrl(finalUrl)) {
            const ids = extractIdsFromLoginRedirect(finalUrl);
            if (ids) {
                const mbasicUrl = `https://mbasic.facebook.com/story.php?story_fbid=${ids.storyFbid}&id=${ids.ownerId}`;
                return mbasicUrl;
            }
        }
    } catch (err) {
        console.error("[fb-photo] mbasic direct resolve failed:", err instanceof Error ? err.message : err);
    }

    console.log("[fb-photo] All resolve attempts failed, returning original URL");
    return url;
}

function extractResolvedUrl(html: string, finalUrl: string, originalUrl: string): string {
    const permalinkMatch = html.match(/"permalink_url"\s*:\s*"(https?:[^"]+)"/);
    if (permalinkMatch) {
        const permalink = decodeEscapedUrl(permalinkMatch[1]);
        console.log(`[fb-photo] Found permalink: ${permalink.substring(0, 100)}`);
        return permalink;
    }

    const storyFbidMatch = html.match(/"story_fbid"\s*:\s*"?(\d+)/);
    const ownerIdMatch = html.match(/"(?:owner_id|actor_id|page_id)"\s*:\s*"?(\d+)/);
    if (storyFbidMatch && ownerIdMatch) {
        const mbasicUrl = `https://mbasic.facebook.com/story.php?story_fbid=${storyFbidMatch[1]}&id=${ownerIdMatch[1]}`;
        console.log(`[fb-photo] Constructed mbasic URL: ${mbasicUrl}`);
        return mbasicUrl;
    }

    if (!finalUrl.includes("pfbid") && !finalUrl.includes("/share/")) {
        return finalUrl;
    }

    const fbidMatches = html.match(/photo\.php\?fbid=(\d+)/g);
    if (fbidMatches && fbidMatches.length > 0) {
        const fbid = fbidMatches[0].match(/fbid=(\d+)/)?.[1];
        if (fbid) {
            return `https://mbasic.facebook.com/photo.php?fbid=${fbid}`;
        }
    }

    return finalUrl;
}

// ─── mbasic photo extraction ─────────────────────────────────────────────────

/**
 * FIX: Extract ALL images from a photo page, not just one.
 * The previous code returned only `[bestImage]` which discarded carousel images.
 * Now we return ALL valid scontent images found on the page.
 */
async function fetchAllImagesFromPhotoPage(
    pageUrl: string,
    cookies: string
): Promise<string[]> {
    const images: string[] = [];
    const seen = new Set<string>();

    try {
        const pageHeaders: Record<string, string> = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
        };
        if (cookies) pageHeaders["Cookie"] = cookies;

        const res = await fetch(pageUrl, { headers: pageHeaders, redirect: "follow" });
        if (!res.ok) return images;
        const photoHtml = await res.text();

        // Get all scontent <img> tags — skip only obvious tiny thumbnails
        const imgPattern = /<img[^>]+src=["'](https?:\/\/[^"']*(?:scontent|fbcdn)[^"']+)["'][^>]*>/gi;
        let m;
        while ((m = imgPattern.exec(photoHtml)) !== null) {
            const decoded = decodeEscapedUrl(m[1]);

            // Skip profile pics (50x50, 100x100) and very small images
            if (decoded.includes("/p50x50/") || decoded.includes("/p100x100/") ||
                decoded.includes("/s50x50/") || decoded.includes("/s100x100/") ||
                decoded.includes("_t.jpg")) {
                continue;
            }

            // Skip images flagged as non-post (emoji, icons, etc.)
            if (!isPostPhoto(decoded)) continue;

            if (!seen.has(decoded)) {
                seen.add(decoded);
                images.push(decoded);
            }
        }

        // Also check "View Full Size" links — these give the highest resolution
        const fullSizePattern = /href=["'](\/photo\/view_full_size\/\?[^"']+)["']/gi;
        while ((m = fullSizePattern.exec(photoHtml)) !== null) {
            try {
                const fullUrl = `https://mbasic.facebook.com${decodeEscapedUrl(m[1]).replace(/&amp;/g, "&")}`;
                const fullHeaders: Record<string, string> = {
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html,image/*,*/*",
                };
                if (cookies) fullHeaders["Cookie"] = cookies;

                const fullRes = await fetch(fullUrl, { headers: fullHeaders, redirect: "follow" });
                if (fullRes.ok) {
                    const ct = fullRes.headers.get("content-type") || "";
                    if (ct.startsWith("image/")) {
                        if (!seen.has(fullRes.url)) {
                            seen.add(fullRes.url);
                            images.push(fullRes.url);
                        }
                    } else {
                        const fullHtml = await fullRes.text();
                        const directPattern = /<img[^>]+src=["'](https?:\/\/[^"']*(?:scontent|fbcdn)[^"']+)["']/gi;
                        while ((m = directPattern.exec(fullHtml)) !== null) {
                            const decoded = decodeEscapedUrl(m[1]);
                            if (!seen.has(decoded) && isPostPhoto(decoded)) {
                                seen.add(decoded);
                                images.push(decoded);
                            }
                        }
                    }
                }
            } catch { /* ignore */ }
        }

        // JSON-embedded image URIs (mbasic sometimes has these)
        const jsonUriPattern = /"uri"\s*:\s*"(https?:[^"]+(?:scontent|fbcdn)[^"]+)"/gi;
        while ((m = jsonUriPattern.exec(photoHtml)) !== null) {
            const decoded = decodeEscapedUrl(m[1]);
            if (!seen.has(decoded) && isPostPhoto(decoded)) {
                seen.add(decoded);
                images.push(decoded);
            }
        }

    } catch (err) {
        console.error(`[fb-photo] fetchAllImagesFromPhotoPage error for ${pageUrl}:`, err instanceof Error ? err.message : err);
    }

    return images;
}

/**
 * FIX: For share/p/ links we need to also scrape all photo page links
 * from the carousel/album, not just from the single resolved post page.
 *
 * Strategy:
 * 1. Resolve share URL → mbasic post page
 * 2. Find ALL photo page links on the post page
 * 3. Fetch EACH photo page and collect ALL images (not just one)
 * 4. Also collect direct <img> from the post page itself as backup
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

    // If URL has pfbid or share/, resolve it first
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

    if (html.includes("went wrong") || html.includes("Back to Home") || html.length < 5000) {
        console.log("[fb-photo] mbasic: error page or too small");
        return result;
    }
    if (html.includes("login_form") && html.length < 20000) {
        console.log("[fb-photo] mbasic: login wall");
        return result;
    }

    result.title = extractTitle(html);
    result.uploader = extractUploader(html);

    // ── Step 1: Find ALL photo page links on the post ──
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

    // Pattern 2: /USERNAME/photos/... and /pages/.../photos/...
    const photosLinkPattern = /href=["'](\/[^"']+\/photos?\/[^"']+)["']/gi;
    while ((match = photosLinkPattern.exec(html)) !== null) {
        const rawUrl = match[1].replace(/&amp;/g, "&");
        if (!seenLinks.has(rawUrl)) {
            seenLinks.add(rawUrl);
            photoLinks.push(`https://mbasic.facebook.com${rawUrl}`);
        }
    }

    // Pattern 3: /media/set?set=... (albums)
    const albumPattern = /href=["'](\/media\/set\?[^"']+)["']/gi;
    while ((match = albumPattern.exec(html)) !== null) {
        const rawUrl = match[1].replace(/&amp;/g, "&");
        if (!seenLinks.has(rawUrl)) {
            seenLinks.add(rawUrl);
            photoLinks.push(`https://mbasic.facebook.com${rawUrl}`);
        }
    }

    console.log(`[fb-photo] mbasic: found ${photoLinks.length} photo page links`);

    // ── Step 2: Collect direct <img> from the post page itself (backup) ──
    const directImages: string[] = [];
    const imgPattern = /<img[^>]+src=["'](https?:\/\/[^"']*(?:scontent|fbcdn)[^"']+)["'][^>]*>/gi;
    while ((match = imgPattern.exec(html)) !== null) {
        const decoded = decodeEscapedUrl(match[1]);
        if (decoded.includes("/p50x50/") || decoded.includes("/p100x100/") ||
            decoded.includes("/s50x50/") || decoded.includes("/s100x100/") ||
            decoded.includes("_t.jpg")) {
            continue;
        }
        if (isPostPhoto(decoded)) {
            directImages.push(decoded);
        }
    }

    console.log(`[fb-photo] mbasic: ${directImages.length} direct images on post page`);

    // ── Step 3: Fetch EACH photo page and collect ALL images ──
    // FIX: We now use fetchAllImagesFromPhotoPage which returns ALL images,
    // not just the single "best" one. This is critical for multi-photo posts.
    if (photoLinks.length > 0) {
        const BATCH_SIZE = 3;
        const allPageImages: string[] = [];

        for (let i = 0; i < photoLinks.length; i += BATCH_SIZE) {
            const batch = photoLinks.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
                batch.map(pageUrl => fetchAllImagesFromPhotoPage(pageUrl, cookies))
            );

            for (const res of results) {
                if (res.status === "fulfilled") {
                    for (const img of res.value) {
                        if (!result.images.includes(img)) {
                            result.images.push(img);
                        }
                    }
                    allPageImages.push(...res.value);
                }
            }
        }

        console.log(`[fb-photo] mbasic: collected ${result.images.length} images from ${photoLinks.length} photo pages`);
    }

    // If fetching individual photo pages found nothing, fall back to direct post-page images
    if (result.images.length === 0 && directImages.length > 0) {
        console.log(`[fb-photo] mbasic: falling back to ${directImages.length} direct images`);
        result.images = directImages;
    }

    console.log(`[fb-photo] mbasic total: ${result.images.length} photos`);
    return result;
}

// ─── Mobile share/p/ resolver ─────────────────────────────────────────────────
/**
 * FIX: Handle mobile browsers visiting share/p/ links.
 *
 * When a mobile browser opens https://facebook.com/share/p/XXXX, Facebook
 * redirects to the app or a mobile login page. We bypass this by:
 * 1. Fetching with a desktop User-Agent (forces HTML response)
 * 2. OR fetching via mbasic.facebook.com (always returns HTML)
 *
 * This function is called from the API route, not here directly — but we
 * improve robustness by making mbasic the primary strategy for share/p/ links.
 */
async function resolveShareLink(url: string, cookies: string): Promise<string> {
    // Always convert share/p/ to mbasic first — it's the most reliable
    const mbasicUrl = url
        .replace(/^https?:\/\/(www\.)?facebook\.com/, "https://mbasic.facebook.com")
        .replace(/^https?:\/\/m\.facebook\.com/, "https://mbasic.facebook.com");

    try {
        const headers: Record<string, string> = {
            "User-Agent": USER_AGENT, // Desktop UA — avoids app redirect
            "Accept": "text/html",
        };
        if (cookies) headers["Cookie"] = cookies;

        const res = await fetch(mbasicUrl, { headers, redirect: "follow" });
        const finalUrl = res.url;
        const html = await res.text();

        console.log(`[fb-photo] resolveShareLink: ${finalUrl.substring(0, 100)}, ${html.length} bytes`);

        if (!isLoginUrl(finalUrl) && html.length > 5000 && !html.includes("login_form")) {
            return finalUrl; // mbasic loaded the post directly
        }

        // Login wall — try to extract IDs
        if (isLoginUrl(finalUrl)) {
            const ids = extractIdsFromLoginRedirect(finalUrl);
            if (ids) {
                return `https://mbasic.facebook.com/story.php?story_fbid=${ids.storyFbid}&id=${ids.ownerId}`;
            }
        }
    } catch (err) {
        console.error("[fb-photo] resolveShareLink mbasic failed:", err instanceof Error ? err.message : err);
    }

    // Fallback: standard resolver
    return resolveUrl(url, cookies);
}

// ─── Main scraper ─────────────────────────────────────────────────────────────

export async function scrapeFacebookPhotos(url: string): Promise<MediaInfo> {
    console.log(`[fb-photo] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[fb-photo] Scraping: ${url}`);

    const cookies = getCachedFacebookCookies();
    let allImages: string[] = [];
    let title = "Facebook Post";
    let uploader = "Facebook User";

    // ─── FAST PATH: share/p/ links → go straight to mbasic ─────────────────
    // share/p/ URLs on desktop redirect to the post, but on mobile they redirect
    // to the app or login page. Using mbasic always works reliably from a server.
    const isShareLink = /facebook\.com\/share\/p\//i.test(url);

    if (isShareLink) {
        console.log("[fb-photo] Detected share/p/ link — using mbasic fast path");
        try {
            const resolvedMbasicUrl = await resolveShareLink(url, cookies);
            console.log(`[fb-photo] Resolved share link to: ${resolvedMbasicUrl.substring(0, 100)}`);

            const mbasicResult = await extractMbasicPhotos(resolvedMbasicUrl, cookies);
            if (mbasicResult.images.length > 0) {
                allImages = mbasicResult.images;
                title = mbasicResult.title;
                uploader = mbasicResult.uploader;
                console.log(`[fb-photo] share/p/ mbasic fast path: ${allImages.length} photos`);
            }
        } catch (err) {
            console.error("[fb-photo] share/p/ fast path failed:", err instanceof Error ? err.message : err);
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STRATEGY 1: Desktop page WITHOUT cookies (for non-share links or as fallback)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let needsAuth = false;
    if (!isShareLink || allImages.length === 0) {
        try {
            console.log("[fb-photo] Strategy 1: Desktop page (no cookies)");
            const { html } = await fetchPage(url, {});
            console.log(`[fb-photo] Desktop page: ${html.length} bytes`);

            const hasContent = html.includes("og:image") || html.includes("scontent");
            const isLoginWall = html.length < 50000 && !hasContent && (
                html.includes("login_form") || html.includes("You must log in")
            );

            if (isLoginWall) {
                console.log("[fb-photo] Desktop page: login wall → needs auth");
                needsAuth = true;
            } else {
                const subImages = extractSubattachmentImages(html);
                const ogImages = extractOgImages(html).filter(img => img.includes("scontent"));

                if (subImages.length > 0) {
                    for (const img of subImages) {
                        if (!allImages.includes(img)) allImages.push(img);
                    }
                    for (const img of ogImages) {
                        if (!allImages.includes(img)) allImages.push(img);
                    }
                    console.log(`[fb-photo] Desktop: ${subImages.length} subattachment + ${ogImages.length} OG`);
                } else {
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
            if (err instanceof Error && err.message.startsWith("LOGIN_REDIRECT")) {
                console.log("[fb-photo] Login redirect → needs auth");
                needsAuth = true;

                const loginRedirectUrl = err.message.split("LOGIN_REDIRECT:")[1] || "";
                if (loginRedirectUrl) {
                    const ids = extractIdsFromLoginRedirect(loginRedirectUrl);
                    if (ids) {
                        try {
                            const directMbasicUrl = `https://mbasic.facebook.com/story.php?story_fbid=${ids.storyFbid}&id=${ids.ownerId}`;
                            const mbasicResult = await extractMbasicPhotos(directMbasicUrl, cookies);
                            if (mbasicResult.images.length > 0) {
                                allImages = mbasicResult.images;
                                title = mbasicResult.title;
                                uploader = mbasicResult.uploader;
                                needsAuth = false;
                            }
                        } catch (mbasicErr) {
                            console.error("[fb-photo] Direct mbasic from login redirect failed:", mbasicErr instanceof Error ? mbasicErr.message : mbasicErr);
                        }
                    }
                }
            } else {
                console.error("[fb-photo] Desktop strategy failed:", err instanceof Error ? err.message : err);
            }
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STRATEGY 2: mbasic WITH cookies (when auth needed or too few photos found)
    // We use < 2 as the threshold because some posts have multiple photos
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if ((needsAuth || allImages.length < 2) && cookies) {
        try {
            console.log(`[fb-photo] Strategy 2: mbasic with cookies (needsAuth=${needsAuth}, currentPhotos=${allImages.length})`);
            const mbasicResult = await extractMbasicPhotos(url, cookies);

            if (mbasicResult.images.length > 0) {
                if (needsAuth) {
                    allImages = mbasicResult.images;
                    console.log(`[fb-photo] mbasic (primary): ${mbasicResult.images.length} photos`);
                } else {
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
    // STRATEGY 3: mbasic WITHOUT cookies (for share/p/ with no auth)
    // This specifically helps mobile browser share links
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (allImages.length === 0 || (isShareLink && allImages.length < 2)) {
        try {
            console.log("[fb-photo] Strategy 3: mbasic without cookies");
            const mbasicResult = await extractMbasicPhotos(url, "");

            if (mbasicResult.images.length > 0) {
                for (const img of mbasicResult.images) {
                    if (!allImages.includes(img)) allImages.push(img);
                }
                console.log(`[fb-photo] mbasic (no-auth): ${mbasicResult.images.length} photos, total: ${allImages.length}`);
                if (title === "Facebook Post") title = mbasicResult.title;
                if (uploader === "Facebook User") uploader = mbasicResult.uploader;
            }
        } catch (err) {
            console.error("[fb-photo] mbasic (no-auth) strategy failed:", err instanceof Error ? err.message : err);
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STRATEGY 4: Mobile page (last resort)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (allImages.length === 0) {
        try {
            console.log("[fb-photo] Strategy 4: Mobile page");
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

    // Filter out tiny images (< 150px max dimension)
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