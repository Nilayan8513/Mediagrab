import { NextRequest, NextResponse } from "next/server";

/**
 * YouTube InnerTube API — extracts video/audio streams directly.
 * No yt-dlp, no cookies, no server crashes.
 * Uses YouTube's internal API (same as the web player).
 */

const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const INNERTUBE_CLIENT = {
    clientName: "ANDROID",
    clientVersion: "19.09.37",
    androidSdkVersion: 30,
    userAgent:
        "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
    hl: "en",
    gl: "US",
};

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

async function fetchInnerTube(videoId: string) {
    const body = {
        videoId,
        context: {
            client: INNERTUBE_CLIENT,
        },
        params: "8AEB",
    };

    const res = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}&prettyPrint=false`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": INNERTUBE_CLIENT.userAgent,
                "X-YouTube-Client-Name": "3",
                "X-YouTube-Client-Version": INNERTUBE_CLIENT.clientVersion,
                Origin: "https://www.youtube.com",
                Referer: "https://www.youtube.com/",
            },
            body: JSON.stringify(body),
        }
    );

    if (!res.ok) throw new Error(`InnerTube API error: ${res.status}`);
    return res.json();
}

export async function POST(request: NextRequest) {
    try {
        const { url } = await request.json();
        if (!url) return NextResponse.json({ error: "URL required" }, { status: 400 });

        const videoId = extractVideoId(url);
        if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

        const data = await fetchInnerTube(videoId);

        // Check for errors from YouTube
        const status = data?.playabilityStatus?.status;
        if (status === "LOGIN_REQUIRED") {
            return NextResponse.json(
                { error: "This video is age-restricted or private." },
                { status: 403 }
            );
        }
        if (status === "UNPLAYABLE" || status === "ERROR") {
            const reason = data?.playabilityStatus?.reason || "Video unavailable";
            return NextResponse.json({ error: reason }, { status: 400 });
        }

        const details = data?.videoDetails || {};
        const streamingData = data?.streamingData || {};

        // All formats combined
        const allFormats: unknown[] = [
            ...(streamingData.formats || []),
            ...(streamingData.adaptiveFormats || []),
        ];

        // Video formats (with and without audio)
        const videoFormats = allFormats
            .filter((f: any) => f.mimeType?.startsWith("video/") && f.url)
            .map((f: any) => {
                const hasAudio = !!(f.audioQuality);
                return {
                    format_id: String(f.itag),
                    quality: buildQualityLabel(f.height || 0),
                    ext: f.mimeType.includes("mp4") ? "mp4" : "webm",
                    filesize: f.contentLength ? parseInt(f.contentLength) : null,
                    url: f.url,
                    has_audio: hasAudio,
                    height: f.height || 0,
                    fps: f.fps || null,
                    vcodec: f.mimeType?.split('codecs="')[1]?.replace('"', '') || null,
                };
            })
            .filter((f) => f.height > 0)
            // Deduplicate by quality, prefer has_audio
            .sort((a, b) => {
                const hd = b.height - a.height;
                if (hd !== 0) return hd;
                return (b.has_audio ? 1 : 0) - (a.has_audio ? 1 : 0);
            });

        // Deduplicate by quality label
        const seen = new Set<string>();
        const uniqueFormats = videoFormats.filter((f) => {
            if (seen.has(f.quality)) return false;
            seen.add(f.quality);
            return true;
        });

        // Best audio stream (for merging with video-only formats)
        const audioFormats = allFormats
            .filter((f: any) => f.mimeType?.startsWith("audio/") && f.url)
            .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
        const bestAudio = (audioFormats[0] as any)?.url || null;

        // Thumbnail
        const thumbnails = details.thumbnail?.thumbnails || [];
        const thumbnail = thumbnails.sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0]?.url || "";

        const mediaInfo = {
            platform: "youtube",
            title: details.title || "YouTube Video",
            uploader: details.author || "Unknown",
            items: [
                {
                    type: "video",
                    title: details.title || "YouTube Video",
                    thumbnail,
                    duration: details.lengthSeconds ? parseInt(details.lengthSeconds) : null,
                    formats: uniqueFormats,
                    direct_url: null,
                    audio_url: bestAudio,
                    index: 0,
                },
            ],
            original_url: url,
        };

        return NextResponse.json(mediaInfo);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch video info";
        console.error("InnerTube error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}