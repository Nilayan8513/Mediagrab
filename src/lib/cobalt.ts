/**
 * Cobalt API client — YouTube fallback when yt-dlp signature is broken.
 * Only used for YouTube. Other platforms continue using yt-dlp.
 * API docs: https://github.com/imputnet/cobalt
 */

// Public Cobalt API instance
const COBALT_API = "https://api.cobalt.tools";

interface CobaltResponse {
    status: "tunnel" | "redirect" | "picker" | "error";
    url?: string;
    picker?: Array<{ url: string; type: "video" | "photo" }>;
    error?: string;
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
    platform: "youtube";
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

// Quality presets Cobalt supports
const QUALITY_PRESETS = [
    { quality: "2160", label: "4K (2160p)", height: 2160 },
    { quality: "1440", label: "2K (1440p)", height: 1440 },
    { quality: "1080", label: "1080p", height: 1080 },
    { quality: "720", label: "720p", height: 720 },
    { quality: "480", label: "480p", height: 480 },
    { quality: "360", label: "360p", height: 360 },
];

async function cobaltRequest(url: string, quality: string = "1080"): Promise<CobaltResponse> {
    const res = await fetch(`${COBALT_API}/api/json`, {
        method: "POST",
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            url,
            vQuality: quality,
            filenamePattern: "basic",
            isAudioOnly: false,
        }),
    });

    if (!res.ok) {
        throw new Error(`Cobalt API error: ${res.status} ${res.statusText}`);
    }

    return res.json();
}

async function cobaltAudioRequest(url: string): Promise<CobaltResponse> {
    const res = await fetch(`${COBALT_API}/api/json`, {
        method: "POST",
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            url,
            isAudioOnly: true,
            aFormat: "mp3",
            filenamePattern: "basic",
        }),
    });

    if (!res.ok) {
        throw new Error(`Cobalt API error: ${res.status} ${res.statusText}`);
    }

    return res.json();
}

/**
 * Analyze a YouTube URL via Cobalt API.
 * Returns format info similar to yt-dlp's output so the rest of the app works seamlessly.
 */
export async function analyzeWithCobalt(url: string): Promise<CobaltResult> {
    // Get the best quality to extract title/metadata
    const bestResult = await cobaltRequest(url, "1080");

    if (bestResult.status === "error") {
        throw new Error(bestResult.error || "Cobalt could not process this URL");
    }

    // Build format list — probe key qualities (keep it fast: only 3 calls)
    const formats: CobaltFormat[] = [];

    // Use the initial bestResult as 1080p
    if (bestResult.status === "tunnel" || bestResult.status === "redirect") {
        if (bestResult.url) {
            formats.push({
                format_id: "cobalt_1080",
                quality: "1080p",
                ext: "mp4",
                filesize: null,
                url: bestResult.url,
                has_audio: true,
                height: 1080,
                resolution: "1080p",
                vcodec: "h264",
                acodec: "aac",
                fps: null,
            });
        }
    }

    // Probe additional qualities (4K, 1440p, 720p, 480p)
    for (const preset of [
        { quality: "2160", label: "4K (2160p)", height: 2160 },
        { quality: "1440", label: "2K (1440p)", height: 1440 },
        { quality: "720", label: "720p", height: 720 },
        { quality: "480", label: "480p", height: 480 },
    ]) {
        try {
            const result = await cobaltRequest(url, preset.quality);
            if ((result.status === "tunnel" || result.status === "redirect") && result.url) {
                formats.push({
                    format_id: `cobalt_${preset.quality}`,
                    quality: preset.label,
                    ext: "mp4",
                    filesize: null,
                    url: result.url,
                    has_audio: true,
                    height: preset.height,
                    resolution: `${preset.height}p`,
                    vcodec: "h264",
                    acodec: "aac",
                    fps: null,
                });
            }
        } catch {
            // Quality not available, skip
        }
    }

    // If no individual qualities worked, use the best result
    if (formats.length === 0 && (bestResult.status === "tunnel" || bestResult.status === "redirect") && bestResult.url) {
        formats.push({
            format_id: "cobalt_best",
            quality: "Best",
            ext: "mp4",
            filesize: null,
            url: bestResult.url,
            has_audio: true,
            height: 1080,
            resolution: "1080p",
            vcodec: "h264",
            acodec: "aac",
            fps: null,
        });
    }

    // Try to get audio URL
    let audioUrl: string | null = null;
    try {
        const audioResult = await cobaltAudioRequest(url);
        if ((audioResult.status === "tunnel" || audioResult.status === "redirect") && audioResult.url) {
            audioUrl = audioResult.url;
        }
    } catch { /* audio not available */ }

    // Extract video ID for thumbnail
    const videoIdMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : "";
    const thumbnail = videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : "";

    return {
        platform: "youtube",
        title: bestResult.filename?.replace(/\.[^.]+$/, "") || "YouTube Video",
        uploader: "YouTube",
        items: [{
            type: "video",
            title: bestResult.filename?.replace(/\.[^.]+$/, "") || "YouTube Video",
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
