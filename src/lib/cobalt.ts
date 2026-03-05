/**
 * Cobalt API client — fallback for YouTube, Twitter, and Facebook.
 * Returns direct MP4 URLs that can be proxied client-side.
 * 
 * NOTE: The public api.cobalt.tools now requires JWT auth (Turnstile).
 * To use Cobalt, you must either:
 * 1. Self-host: docker run -d -p 9000:9000 ghcr.io/imputnet/cobalt:latest
 * 2. Set COBALT_API_URL env variable to your instance URL
 * 
 * API docs: https://github.com/imputnet/cobalt/blob/main/docs/api.md
 */

// Use self-hosted instance or env variable — NO public instance works without auth
const COBALT_API = process.env.COBALT_API_URL || "http://localhost:9000";

type CobaltPlatform = "youtube" | "twitter" | "facebook";

interface CobaltResponse {
    status: "tunnel" | "redirect" | "picker" | "local-processing" | "error";
    url?: string;
    picker?: Array<{ url: string; type: "video" | "photo" }>;
    error?: { code: string };
    filename?: string;
}

interface CobaltFormat {
    format_id: string;
    quality: string;
    ext: string;
    filesize: number | null;
    url: string;
    has_audio: boolean;
    height: number;
    resolution: string | null;
    vcodec: string | null;
    acodec: string | null;
    fps: number | null;
}

interface CobaltResult {
    platform: CobaltPlatform;
    title: string;
    uploader: string;
    items: Array<{
        type: "video" | "photo";
        title: string;
        thumbnail: string;
        duration: number | null;
        formats: CobaltFormat[];
        direct_url: string | null;
        audio_url: string | null;
        index: number;
    }>;
    original_url: string;
}

async function cobaltRequest(url: string, videoQuality: string = "1080"): Promise<CobaltResponse> {
    const res = await fetch(`${COBALT_API}/`, {
        method: "POST",
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            url,
            videoQuality,
            filenameStyle: "basic",
            downloadMode: "auto",
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Cobalt API error: ${res.status} — ${text.substring(0, 200)}`);
    }

    return res.json();
}

async function cobaltAudioRequest(url: string): Promise<CobaltResponse> {
    const res = await fetch(`${COBALT_API}/`, {
        method: "POST",
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            url,
            downloadMode: "audio",
            audioFormat: "mp3",
            filenameStyle: "basic",
        }),
    });

    if (!res.ok) {
        throw new Error(`Cobalt audio API error: ${res.status}`);
    }

    return res.json();
}

function makeCobaltFormat(id: string, label: string, height: number, url: string): CobaltFormat {
    return {
        format_id: id,
        quality: label,
        ext: "mp4",
        filesize: null,
        url,
        has_audio: true,
        height,
        resolution: `${height}p`,
        vcodec: "h264",
        acodec: "aac",
        fps: null,
    };
}

/**
 * Analyze a URL via Cobalt API.
 * Returns format info compatible with yt-dlp's MediaInfo structure.
 */
export async function analyzeWithCobalt(url: string, platform: CobaltPlatform = "youtube"): Promise<CobaltResult> {
    const bestResult = await cobaltRequest(url, "1080");

    if (bestResult.status === "error") {
        throw new Error(bestResult.error?.code || "Cobalt could not process this URL");
    }

    const formats: CobaltFormat[] = [];

    if (platform === "youtube") {
        // YouTube: probe multiple qualities (reuse initial request for 1080p)
        if ((bestResult.status === "tunnel" || bestResult.status === "redirect") && bestResult.url) {
            formats.push(makeCobaltFormat("cobalt_1080", "1080p", 1080, bestResult.url));
        }

        for (const preset of [
            { quality: "2160", label: "4K (2160p)", height: 2160 },
            { quality: "1440", label: "2K (1440p)", height: 1440 },
            { quality: "720", label: "720p", height: 720 },
            { quality: "480", label: "480p", height: 480 },
        ]) {
            try {
                const result = await cobaltRequest(url, preset.quality);
                if ((result.status === "tunnel" || result.status === "redirect") && result.url) {
                    formats.push(makeCobaltFormat(`cobalt_${preset.quality}`, preset.label, preset.height, result.url));
                }
            } catch { /* quality not available */ }
        }

        // Sort: highest quality first
        formats.sort((a, b) => b.height - a.height);
    } else {
        // Twitter/Facebook: single best quality
        if ((bestResult.status === "tunnel" || bestResult.status === "redirect") && bestResult.url) {
            formats.push(makeCobaltFormat("cobalt_best", "Best", 720, bestResult.url));
        }
    }

    // Get audio URL
    let audioUrl: string | null = null;
    try {
        const audioResult = await cobaltAudioRequest(url);
        if ((audioResult.status === "tunnel" || audioResult.status === "redirect") && audioResult.url) {
            audioUrl = audioResult.url;
        }
    } catch { /* no audio */ }

    // Thumbnail
    const videoIdMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : "";
    const thumbnail = videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : "";

    const title = bestResult.filename?.replace(/\.[^.]+$/, "") || `${platform} Video`;

    return {
        platform,
        title,
        uploader: platform.charAt(0).toUpperCase() + platform.slice(1),
        items: [{
            type: "video",
            title,
            thumbnail,
            duration: null,
            formats,
            direct_url: null,
            audio_url: audioUrl,
            index: 0,
        }],
        original_url: url,
    };
}
