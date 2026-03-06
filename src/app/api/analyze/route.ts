import { NextRequest, NextResponse } from "next/server";
import { analyzeUrl, detectPlatform } from "@/lib/ytdlp";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { url } = body;

        if (!url || typeof url !== "string") {
            return NextResponse.json(
                { error: "URL is required" },
                { status: 400 }
            );
        }

        const platform = detectPlatform(url);

        // ── YouTube: Use InnerTube API directly (no yt-dlp, no cookies needed) ──
        if (platform === "youtube") {
            try {
                const innerTubeRes = await fetch(
                    new URL("/api/youtube-innertube", request.url).toString(),
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ url }),
                    }
                );
                const data = await innerTubeRes.json();
                if (innerTubeRes.ok && data.items?.length > 0) {
                    return NextResponse.json(data);
                }
                // If InnerTube fails (age-restricted etc), fall through to yt-dlp
                if (data.error) {
                    return NextResponse.json({ error: data.error }, { status: innerTubeRes.status });
                }
            } catch (err) {
                console.error("InnerTube failed, trying yt-dlp:", err);
            }
        }

        if (platform === "unknown") {
            return NextResponse.json(
                { error: "Unsupported platform. We support YouTube, Instagram, Twitter/X, and Facebook." },
                { status: 400 }
            );
        }

        const mediaInfo = await analyzeUrl(url);

        if (mediaInfo.items.length === 0) {
            return NextResponse.json(
                { error: "No downloadable media found in this post." },
                { status: 404 }
            );
        }

        return NextResponse.json(mediaInfo);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Analysis failed";
        console.error("Analyze error:", message);
        return NextResponse.json(
            { error: message },
            { status: 500 }
        );
    }
}
