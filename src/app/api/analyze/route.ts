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

        // ── YouTube: Use InnerTube API directly (combined formats ≤720p, no merging needed) ──
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
                console.error("InnerTube error (falling back to yt-dlp):", data.error);
            } catch (err) {
                console.error("InnerTube failed, trying yt-dlp:", err);
            }

            // yt-dlp fallback: also cap at 720p combined only
            try {
                const mediaInfo = await analyzeUrl(url);
                // Filter YouTube formats to combined ≤720p only (same policy as InnerTube)
                for (const item of mediaInfo.items) {
                    if (item.type === "video") {
                        item.formats = item.formats.filter(
                            (f) => f.has_audio && (f.height ?? 0) <= 720
                        );
                        // If nothing left, keep best combined regardless of height
                        if (item.formats.length === 0) {
                            // Re-run without height filter but still require audio
                            const allFormats = (mediaInfo as any)._allFormats ?? item.formats;
                            item.formats = allFormats.filter((f: any) => f.has_audio).slice(0, 3);
                        }
                        // Clear audio_url — not needed since all formats are combined
                        item.audio_url = null;
                    }
                }
                if (mediaInfo.items.length > 0) return NextResponse.json(mediaInfo);
            } catch (err) {
                const msg = err instanceof Error ? err.message : "yt-dlp failed";
                return NextResponse.json({ error: msg }, { status: 500 });
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