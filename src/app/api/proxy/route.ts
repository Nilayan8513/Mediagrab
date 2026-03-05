import { NextRequest } from "next/server";

/**
 * Lightweight CORS proxy for CDN URLs.
 * Streams content directly from CDN to client without buffering to disk.
 * Only allows URLs from known media CDNs for security.
 */

const ALLOWED_DOMAINS = [
    "googlevideo.com",      // YouTube CDN
    "youtube.com",
    "ytimg.com",
    "ggpht.com",
    "cdninstagram.com",     // Instagram CDN
    "scontent.cdninstagram.com",
    "scontent",             // Instagram/Facebook scontent CDNs
    "fbcdn.net",            // Facebook CDN
    "pbs.twimg.com",        // Twitter CDN
    "video.twimg.com",
    "ton.twitter.com",
    "facebook.com",
    "fbcdn",
];

function isAllowedUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return ALLOWED_DOMAINS.some(
            (domain) =>
                parsed.hostname.includes(domain) ||
                parsed.hostname.endsWith(`.${domain}`)
        );
    } catch {
        return false;
    }
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
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        };

        // Set appropriate Referer based on CDN
        if (targetUrl.includes("googlevideo.com") || targetUrl.includes("youtube.com")) {
            headers["Referer"] = "https://www.youtube.com/";
        } else if (targetUrl.includes("twimg.com") || targetUrl.includes("twitter.com")) {
            headers["Referer"] = "https://x.com/";
        } else if (targetUrl.includes("cdninstagram") || targetUrl.includes("scontent")) {
            headers["Referer"] = "https://www.instagram.com/";
        } else if (targetUrl.includes("fbcdn") || targetUrl.includes("facebook.com")) {
            headers["Referer"] = "https://www.facebook.com/";
        }

        const response = await fetch(targetUrl, {
            headers,
            redirect: "follow",
        });

        if (!response.ok) {
            return new Response(`CDN returned ${response.status}`, {
                status: response.status,
            });
        }

        const contentType =
            response.headers.get("content-type") || "application/octet-stream";
        const contentLength = response.headers.get("content-length");

        const responseHeaders: Record<string, string> = {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        };

        if (contentLength) {
            responseHeaders["Content-Length"] = contentLength;
        }

        // Get filename from query or derive from content-type
        const filename = request.nextUrl.searchParams.get("filename") || "download";
        responseHeaders["Content-Disposition"] =
            `attachment; filename="${encodeURIComponent(filename)}"`;

        // Stream directly — no disk buffering
        return new Response(response.body, { headers: responseHeaders });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Proxy fetch failed";
        return new Response(message, { status: 502 });
    }
}
