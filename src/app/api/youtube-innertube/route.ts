// src/app/api/youtube-innertube/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Innertube } from "youtubei.js";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

function parseCookiesTxt(content: string): string {
    const cookies: string[] = [];
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const parts = trimmed.split("\t");
        if (parts.length < 7) continue;
        const [domain, , , , , name, value] = parts;
        if (domain.includes("youtube.com") && name && value) {
            cookies.push(`${name}=${value}`);
        }
    }
    return cookies.join("; ");
}

function getYouTubeCookieString(): string {
    if (process.env.YTDLP_COOKIES) {
        try {
            const decoded = Buffer.from(process.env.YTDLP_COOKIES, "base64").toString("utf8");
            const cookieStr = parseCookiesTxt(decoded);
            if (cookieStr) return cookieStr;
        } catch (err) {
            console.error("[innertube] Failed to parse YTDLP_COOKIES:", err);
        }
    }
    const cookiesFile = resolve(process.cwd(), "cookies.txt");
    if (existsSync(cookiesFile)) {
        try {
            const content = readFileSync(cookiesFile, "utf8");
            const cookieStr = parseCookiesTxt(content);
            if (cookieStr) return cookieStr;
        } catch (err) {
            console.error("[innertube] Failed to read cookies.txt:", err);
        }
    }
    return "";
}

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

let ytInstance: Innertube | null = null;
let ytCookieSnapshot = "";

async function getYT(): Promise<Innertube> {
    const cookieStr = getYouTubeCookieString();
    if (!ytInstance || cookieStr !== ytCookieSnapshot) {
        ytInstance = await Innertube.create({
            cookie: cookieStr || undefined,
            retrieve_player: true,
        });
        ytCookieSnapshot = cookieStr;
    }
    return ytInstance;
}

type ClientName = "WEB" | "ANDROID" | "TV_EMBEDDED" | "IOS";

async function getVideoInfo(yt: Innertube, videoId: string, hasCookies: boolean): Promise<{ info: any; client: ClientName }> {
    const errors: string[] = [];
    const clients: ClientName[] = hasCookies
        ? ["WEB", "ANDROID", "TV_EMBEDDED", "IOS"]
        : ["TV_EMBEDDED", "ANDROID", "IOS", "WEB"];

    for (const client of clients) {
        try {
            const info = await yt.getBasicInfo(videoId, { client });
            const status = info.playability_status?.status;
            if (status === "OK" || !status) return { info, client };
            if (status === "LOGIN_REQUIRED") { errors.push(`${client}: login required`); continue; }
            if (status === "UNPLAYABLE" || status === "ERROR") {
                throw new Error(info.playability_status?.reason || "Video unavailable");
            }
            errors.push(`${client}: status=${status}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("unavailable") || msg.includes("private") || msg.includes("removed")) throw err;
            errors.push(`${client}: ${msg}`);
        }
    }
    throw new Error(`All InnerTube clients failed: ${errors.join("; ")}`);
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

function extractFormats(info: any) {
    const streamingData = info.streaming_data;
    const allFormats = [
        ...(streamingData?.formats ?? []),
        ...(streamingData?.adaptive_formats ?? []),
    ];

    /**
     * STRATEGY: Only expose combined (audio+video) formats up to 720p.
     *
     * Why 720p cap?
     * - YouTube's combined formats (itag 22 = 720p, itag 18 = 360p) have BOTH
     *   video and audio in a single stream → no merging needed → instant download.
     * - 1080p+ on YouTube are always split (video-only + audio-only) and require
     *   FFmpeg merging. On free Railway (512MB RAM, shared CPU) and on mobile
     *   (browser WASM), this is too slow and unreliable.
     * - 720p is perfectly watchable on phones and most screens.
     *
     * We pick only formats where has_video=true AND has_audio=true AND height<=720.
     */
    const combinedFormats = allFormats
        .filter((f: any) => f.has_video && f.has_audio && f.url && (f.height ?? 0) <= 720 && (f.height ?? 0) > 0)
        .map((f: any) => ({
            format_id: String(f.itag),
            quality: buildQualityLabel(f.height ?? 0),
            ext: f.mime_type?.includes("mp4") ? "mp4" : "webm",
            filesize: f.content_length ? parseInt(f.content_length) : null,
            url: f.url,
            has_audio: true,
            height: f.height ?? 0,
            fps: f.fps ?? null,
        }))
        .sort((a: any, b: any) => b.height - a.height);

    // Deduplicate by quality label — keep highest bitrate per quality
    const seen = new Set<string>();
    const uniqueFormats = combinedFormats.filter((f: any) => {
        if (seen.has(f.quality)) return false;
        seen.add(f.quality);
        return true;
    });

    // Best audio-only stream (still needed for audio-only downloads)
    const audioFormats = allFormats
        .filter((f: any) => f.has_audio && !f.has_video && f.url)
        .sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    const bestAudio = (audioFormats[0] as any)?.url ?? null;

    console.log(`[innertube] Combined formats <=720p: ${uniqueFormats.map((f: any) => f.quality).join(", ")}`);

    return { uniqueFormats, bestAudio };
}

export async function POST(request: NextRequest) {
    try {
        const { url } = await request.json();
        if (!url) return NextResponse.json({ error: "URL required" }, { status: 400 });

        const videoId = extractVideoId(url);
        if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

        const cookieStr = getYouTubeCookieString();
        const hasCookies = cookieStr.length > 0;

        const yt = await getYT();
        const { info, client } = await getVideoInfo(yt, videoId, hasCookies);

        const details = info.basic_info;
        const { uniqueFormats, bestAudio } = extractFormats(info);

        if (uniqueFormats.length === 0) {
            // Fallback: reset instance and throw so analyze/route.ts falls back to yt-dlp
            ytInstance = null;
            return NextResponse.json(
                { error: "No combined formats found — falling back to yt-dlp" },
                { status: 404 }
            );
        }

        const thumbnails = details.thumbnail ?? [];
        const thumbnail = [...thumbnails].sort((a: any, b: any) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? "";

        console.log(`[innertube] "${details.title}" — ${uniqueFormats.length} formats via ${client}`);

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
        ytInstance = null;
        const message = err instanceof Error ? err.message : "Failed to fetch video info";
        console.error("[innertube] Error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}