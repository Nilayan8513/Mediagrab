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
            if (cookieStr) {
                console.log(`[innertube] Loaded cookies from YTDLP_COOKIES env var`);
                return cookieStr;
            }
        } catch (err) {
            console.error("[innertube] Failed to parse YTDLP_COOKIES:", err);
        }
    }

    const cookiesFile = resolve(process.cwd(), "cookies.txt");
    if (existsSync(cookiesFile)) {
        try {
            const content = readFileSync(cookiesFile, "utf8");
            const cookieStr = parseCookiesTxt(content);
            if (cookieStr) {
                console.log(`[innertube] Loaded cookies from cookies.txt`);
                return cookieStr;
            }
        } catch (err) {
            console.error("[innertube] Failed to read cookies.txt:", err);
        }
    }

    console.warn("[innertube] No cookies found — datacenter IPs will likely be blocked by YouTube");
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

let ytInstance: Innertube | null = null;
let ytCookieSnapshot = "";

async function getYT(): Promise<Innertube> {
    const cookieStr = getYouTubeCookieString();
    if (!ytInstance || cookieStr !== ytCookieSnapshot) {
        console.log("[innertube] Creating new Innertube instance" + (cookieStr ? " with cookies" : " WITHOUT cookies"));
        ytInstance = await Innertube.create({
            cookie: cookieStr || undefined,
            retrieve_player: true,
        });
        ytCookieSnapshot = cookieStr;
    }
    return ytInstance;
}

type ClientName = "WEB" | "ANDROID" | "TV_EMBEDDED" | "IOS";

function getClientPriority(hasCookies: boolean): ClientName[] {
    if (hasCookies) return ["WEB", "ANDROID", "TV_EMBEDDED", "IOS"];
    return ["TV_EMBEDDED", "ANDROID", "IOS", "WEB"];
}

async function getVideoInfo(yt: Innertube, videoId: string, hasCookies: boolean): Promise<{ info: any; client: ClientName }> {
    const errors: string[] = [];
    const clients = getClientPriority(hasCookies);

    for (const client of clients) {
        try {
            console.log(`[innertube] Trying client: ${client}`);
            const info = await yt.getBasicInfo(videoId, { client });
            const status = info.playability_status?.status;

            if (status === "OK" || !status) {
                console.log(`[innertube] ✓ Client ${client} succeeded`);
                return { info, client };
            }
            if (status === "LOGIN_REQUIRED") {
                console.log(`[innertube] ✗ ${client}: LOGIN_REQUIRED`);
                errors.push(`${client}: login required`);
                continue;
            }
            if (status === "UNPLAYABLE" || status === "ERROR") {
                throw new Error(info.playability_status?.reason || "Video unavailable");
            }
            errors.push(`${client}: status=${status}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("unavailable") || msg.includes("private") || msg.includes("removed")) throw err;
            errors.push(`${client}: ${msg}`);
            console.log(`[innertube] ✗ ${client} error: ${msg}`);
        }
    }

    throw new Error(`All InnerTube clients failed: ${errors.join("; ")}`);
}

function extractFormats(info: any) {
    const streamingData = info.streaming_data;
    const allFormats = [
        ...(streamingData?.formats ?? []),
        ...(streamingData?.adaptive_formats ?? []),
    ];

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

    const seen = new Set<string>();
    const uniqueFormats = videoFormats.filter((f: any) => {
        if (seen.has(f.quality)) return false;
        seen.add(f.quality);
        return true;
    });

    const audioFormats = allFormats
        .filter((f: any) => f.has_audio && !f.has_video && f.url)
        .sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    const bestAudio = (audioFormats[0] as any)?.url ?? null;

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

        const thumbnails = details.thumbnail ?? [];
        const thumbnail = [...thumbnails].sort((a: any, b: any) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? "";

        console.log(`[innertube] "${details.title}" — ${uniqueFormats.length} formats via ${client} ${hasCookies ? "(authenticated)" : "(no cookies)"}`);

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