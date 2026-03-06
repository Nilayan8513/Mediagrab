import { NextRequest } from "next/server";

// Handle CORS preflight (needed for parallel Range-header downloads)
export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Range",
            "Access-Control-Max-Age": "86400",
        },
    });
}

/**
 * Lightweight CORS proxy for CDN URLs.
 * Streams content directly from CDN to client without buffering to disk.
 * Only allows URLs from known media CDNs for security.
 */

const ALLOWED_DOMAINS = [
    "googlevideo.com",
    "youtube.com",
    "ytimg.com",
    "ggpht.com",
    "cdninstagram.com",
    "scontent.cdninstagram.com",
    "scontent",
    "fbcdn.net",
    "pbs.twimg.com",
    "video.twimg.com",
    "ton.twitter.com",
    "facebook.com",
    "fbcdn",
    "rr1---sn",   // YouTube CDN edge nodes (rr1---sn-xxx.googlevideo.com)
    "rr2---sn",
    "rr3---sn",
    "rr4---sn",
    "rr5---sn",
];

function isAllowedUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname;
        return ALLOWED_DOMAINS.some(
            (domain) =>
                host === domain ||
                host.endsWith(`.${domain}`) ||
                host.includes(domain)
        );
    } catch {
        return false;
    }
}

// Also support HEAD so the parallel downloader can probe file sizes
export async function HEAD(request: NextRequest) {
    return GET(request);
}

export async function GET(request: NextRequest) {
    const targetUrl = request.nextUrl.searchParams.get("url");
    if (!targetUrl) {
        return new Response("URL parameter is required", { status: 400 });
    }

    if (!isAllowedUrl(targetUrl)) {
        return new Response("URL domain not allowed", { status: 403 });
    }

    try {
        const headers: Record<string, string> = {
            "User-Agent":
                "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
            // Accept compressed responses from CDN — reduces transfer size
            "Accept-Encoding": "identity",
        };

        if (targetUrl.includes("googlevideo.com") || targetUrl.includes("youtube.com")) {
            headers["Referer"] = "https://www.youtube.com/";
            headers["Origin"] = "https://www.youtube.com";
        } else if (targetUrl.includes("twimg.com") || targetUrl.includes("twitter.com")) {
            headers["Referer"] = "https://x.com/";
            headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        } else if (targetUrl.includes("cdninstagram") || targetUrl.includes("scontent")) {
            headers["Referer"] = "https://www.instagram.com/";
            headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        } else if (targetUrl.includes("fbcdn") || targetUrl.includes("facebook.com")) {
            headers["Referer"] = "https://www.facebook.com/";
            headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        }

        // Forward Range header for resumable/parallel chunk downloads
        const rangeHeader = request.headers.get("Range");
        if (rangeHeader) {
            headers["Range"] = rangeHeader;
        }

        const response = await fetch(targetUrl, {
            headers,
            redirect: "follow",
        });

        if (!response.ok && response.status !== 206) {
            return new Response(`CDN returned ${response.status}`, {
                status: response.status,
            });
        }

        const contentType =
            response.headers.get("content-type") || "application/octet-stream";
        const contentLength = response.headers.get("content-length");
        const contentRange = response.headers.get("content-range");

        const responseHeaders: Record<string, string> = {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Range",
            "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Disposition",
            "Accept-Ranges": "bytes",
            // Allow browser to cache CDN content for 5 minutes — avoids redundant requests
            "Cache-Control": "private, max-age=300",
        };

        if (contentLength) {
            responseHeaders["Content-Length"] = contentLength;
        }

        if (contentRange) {
            responseHeaders["Content-Range"] = contentRange;
        }

        const filename = request.nextUrl.searchParams.get("filename") || "download";
        // Use RFC 6266 format for cross-browser compatibility (especially mobile)
        const safeFilename = filename.replace(/[^\w.\-]/g, "_");
        responseHeaders["Content-Disposition"] =
            `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders,
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Proxy fetch failed";
        return new Response(message, { status: 502 });
    }
}