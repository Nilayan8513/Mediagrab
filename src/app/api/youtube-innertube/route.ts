// src/app/api/youtube-innertube/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Innertube } from "youtubei.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── InnerTube singleton ──────────────────────────────────────────────────────

let ytInstance: Innertube | null = null;
async function getYT() {
    if (!ytInstance) ytInstance = await Innertube.create({ retrieve_player: true });
    return ytInstance;
}

// ─── Client fallback strategy ─────────────────────────────────────────────────
//
// YouTube blocks certain InnerTube clients from data center IPs.
// We try multiple clients in order until one succeeds:
//   1. ANDROID      — best format quality (all resolutions, direct URLs)
//   2. TV_EMBEDDED  — works from data center IPs (embedded player, no auth needed)
//   3. IOS          — sometimes works when others don't
//   4. WEB          — last resort
//
// Each client may return different format sets but all give us streaming URLs.

type ClientName = "ANDROID" | "TV_EMBEDDED" | "IOS" | "WEB";

const CLIENT_PRIORITY: ClientName[] = ["ANDROID", "TV_EMBEDDED", "IOS", "WEB"];

async function getVideoInfo(yt: Innertube, videoId: string): Promise<{ info: any; client: ClientName }> {
    const errors: string[] = [];

    for (const client of CLIENT_PRIORITY) {
        try {
            console.log(`[innertube] Trying client: ${client}`);
            const info = await yt.getBasicInfo(videoId, { client });

            const status = info.playability_status?.status;

            // If this client works, return immediately
            if (status === "OK" || !status) {
                console.log(`[innertube] ✓ Client ${client} succeeded`);
                return { info, client };
            }

            // LOGIN_REQUIRED from data center IP — try next client
            if (status === "LOGIN_REQUIRED") {
                console.log(`[innertube] ✗ Client ${client}: LOGIN_REQUIRED — trying next`);
                errors.push(`${client}: login required`);
                continue;
            }

            // UNPLAYABLE / ERROR — video itself is unavailable, don't retry
            if (status === "UNPLAYABLE" || status === "ERROR") {
                const reason = info.playability_status?.reason || "Video unavailable";
                throw new Error(reason);
            }

            // Unknown status — try next
            errors.push(`${client}: status=${status}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // If it's a definitive video-level error, rethrow immediately
            if (msg.includes("unavailable") || msg.includes("private") || msg.includes("removed")) {
                throw err;
            }
            errors.push(`${client}: ${msg}`);
            console.log(`[innertube] ✗ Client ${client} error: ${msg}`);
        }
    }

    throw new Error(`All InnerTube clients failed: ${errors.join("; ")}`);
}

// ─── Format extraction ────────────────────────────────────────────────────────

function extractFormats(info: any) {
    const streamingData = info.streaming_data;
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

    return { uniqueFormats, bestAudio };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
    try {
        const { url } = await request.json();
        if (!url) return NextResponse.json({ error: "URL required" }, { status: 400 });

        const videoId = extractVideoId(url);
        if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

        const yt = await getYT();
        const { info, client } = await getVideoInfo(yt, videoId);

        const details = info.basic_info;
        const { uniqueFormats, bestAudio } = extractFormats(info);

        // Thumbnail
        const thumbnails = details.thumbnail ?? [];
        const thumbnail = [...thumbnails].sort((a: any, b: any) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? "";

        console.log(`[innertube] ${details.title} — ${uniqueFormats.length} formats via ${client}`);

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