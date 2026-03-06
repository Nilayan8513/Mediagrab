// src/app/api/youtube-innertube/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Innertube } from "youtubei.js";

function extractVideoId(url: string): string | null {
    const patterns = [
        /(?:v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

function buildQualityLabel(height: number): string {
    if (height >= 4320) return "8K";
    if (height >= 2160) return "4K";
    if (height >= 1440) return "1440p";
    if (height >= 1080) return "1080p";
    if (height >= 720) return "720p";
    if (height >= 480) return "480p";
    if (height >= 360) return "360p";
    if (height >= 240) return "240p";
    return `${height}p`;
}

// Singleton — reuse across requests to avoid re-creating the client each time
let ytInstance: Innertube | null = null;
async function getYT() {
    if (!ytInstance) ytInstance = await Innertube.create({ retrieve_player: true });
    return ytInstance;
}

export async function POST(request: NextRequest) {
    try {
        const { url } = await request.json();
        if (!url) return NextResponse.json({ error: "URL required" }, { status: 400 });

        const videoId = extractVideoId(url);
        if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

        const yt = await getYT();
        const info = await yt.getBasicInfo(videoId, { client: "ANDROID" });

        const status = info.playability_status?.status;
        if (status === "LOGIN_REQUIRED") {
            return NextResponse.json({ error: "This video is age-restricted or private." }, { status: 403 });
        }
        if (status === "UNPLAYABLE" || status === "ERROR") {
            return NextResponse.json({ error: info.playability_status?.reason || "Video unavailable" }, { status: 400 });
        }

        const streamingData = info.streaming_data;
        const details = info.basic_info;

        const allFormats = [
            ...(streamingData?.formats ?? []),
            ...(streamingData?.adaptive_formats ?? []),
        ];

        // Video formats
        const videoFormats = allFormats
            .filter((f: any) => f.has_video && f.url)
            .map((f: any) => ({
                format_id: String(f.itag),
                quality: buildQualityLabel(f.height ?? 0),
                ext: f.mime_type?.includes("mp4") ? "mp4" : "webm",
                filesize: f.content_length ? parseInt(f.content_length) : null,
                url: f.url,
                has_audio: f.has_audio ?? false,
                height: f.height ?? 0,
                fps: f.fps ?? null,
            }))
            .filter((f: any) => f.height > 0)
            .sort((a: any, b: any) => {
                const hd = b.height - a.height;
                if (hd !== 0) return hd;
                return (b.has_audio ? 1 : 0) - (a.has_audio ? 1 : 0);
            });

        // Deduplicate by quality label
        const seen = new Set<string>();
        const uniqueFormats = videoFormats.filter((f: any) => {
            if (seen.has(f.quality)) return false;
            seen.add(f.quality);
            return true;
        });

        // Best audio stream
        const audioFormats = allFormats
            .filter((f: any) => f.has_audio && !f.has_video && f.url)
            .sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
        const bestAudio = (audioFormats[0] as any)?.url ?? null;

        // Thumbnail
        const thumbnails = details.thumbnail ?? [];
        const thumbnail = [...thumbnails].sort((a: any, b: any) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? "";

        return NextResponse.json({
            platform: "youtube",
            title: details.title ?? "YouTube Video",
            uploader: details.author ?? "Unknown",
            items: [{
                type: "video",
                title: details.title ?? "YouTube Video",
                thumbnail,
                duration: details.duration ?? null,
                formats: uniqueFormats,
                direct_url: null,
                audio_url: bestAudio,
                index: 0,
            }],
            original_url: url,
        });
    } catch (err) {
        // Reset instance on error so next request gets a fresh one
        ytInstance = null;
        const message = err instanceof Error ? err.message : "Failed to fetch video info";
        console.error("youtubei.js error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}