import { NextRequest } from "next/server";

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

        const filename = request.nextUrl.searchParams.get("filename") || "download";
        responseHeaders["Content-Disposition"] =
            `attachment; filename="${encodeURIComponent(filename)}"`;

        return new Response(response.body, { headers: responseHeaders });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Proxy fetch failed";
        return new Response(message, { status: 502 });
    }
}