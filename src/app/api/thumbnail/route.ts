import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy route for thumbnails — fetches external thumbnail URLs server-side
 * to avoid CORS issues in the browser.
 * Usage: /api/thumbnail?url=<encoded-url>
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");

    if (!url) {
        return NextResponse.json({ error: "url parameter is required" }, { status: 400 });
    }

    // Only proxy http/https URLs
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Referer": new URL(url).origin + "/",
            },
        });

        if (!res.ok) {
            return NextResponse.json({ error: `Upstream error: ${res.status}` }, { status: 502 });
        }

        const contentType = res.headers.get("content-type") || "image/jpeg";
        const buffer = await res.arrayBuffer();

        return new Response(buffer, {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=86400",
                "Access-Control-Allow-Origin": "*",
            },
        });
    } catch (err) {
        console.error("Thumbnail proxy error:", err);
        return NextResponse.json({ error: "Failed to fetch thumbnail" }, { status: 502 });
    }
}
