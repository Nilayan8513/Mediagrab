// src/lib/twitter-scraper.ts  — Syndication API, no auth needed

function extractTweetId(url: string): string | null {
    const match = url.match(/(?:twitter|x)\.com\/\w+\/status\/(\d+)/i);
    return match ? match[1] : null;
}

// Token can be anything — Twitter doesn't validate it, just requires the param
function syndicationToken(tweetId: string): string {
    // Simple deterministic value so it looks plausible
    return String(parseInt(tweetId.slice(-6), 10) % 100000000).padStart(8, "0");
}

function buildQualityLabel(height: number): string {
    if (height >= 1080) return "1080p";
    if (height >= 720) return "720p";
    if (height >= 480) return "480p";
    if (height >= 360) return "360p";
    return `${height}p`;
}

function extractResolution(url: string) {
    const match = url.match(/\/(\d{2,4})x(\d{2,4})\//);
    if (match) {
        const a = parseInt(match[1]), b = parseInt(match[2]);
        return { width: Math.max(a, b), height: Math.min(a, b) };
    }
    return null;
}

export async function analyzeTwitterUrl(url: string) {
    const tweetId = extractTweetId(url);
    if (!tweetId) throw new Error("Invalid Twitter/X URL");

    const token = syndicationToken(tweetId);
    const apiUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=${token}&lang=en`;

    const res = await fetch(apiUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json",
            "Referer": "https://platform.twitter.com/",
        },
    });

    if (!res.ok) throw new Error(`Syndication API returned ${res.status}`);
    const data = await res.json();

    if (!data || data.errors) {
        throw new Error("Tweet not found or unavailable");
    }

    const text: string = data.text ?? data.full_text ?? "";
    const title = text.length > 100 ? text.slice(0, 97) + "..." : text || "Twitter Video";
    const uploader: string = data.user?.name ?? data.user?.screen_name ?? "Unknown";

    const allMedia: any[] = data.mediaDetails ?? data.entities?.media ?? [];
    const items: any[] = [];

    for (let i = 0; i < allMedia.length; i++) {
        const media = allMedia[i];

        if (media.type === "video" || media.type === "animated_gif") {
            const variants: any[] = media.video_info?.variants ?? [];
            const duration = media.video_info?.duration_millis
                ? Math.round(media.video_info.duration_millis / 1000) : null;

            const mp4Variants = variants
                .filter((v) => v.content_type === "video/mp4" && v.url && !v.url.includes("m3u8"))
                .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

            const formats = mp4Variants.map((v, idx) => {
                const res = extractResolution(v.url);
                const height = res?.height ?? 720;
                return {
                    format_id: `tw_mp4_${idx}`,
                    quality: buildQualityLabel(height),
                    ext: "mp4",
                    filesize: null,
                    resolution: res ? `${res.width}x${res.height}` : null,
                    vcodec: "h264", acodec: "aac",
                    height, fps: null,
                    url: v.url,
                    has_audio: true,
                };
            });

            const seen = new Set<string>();
            const uniqueFormats = formats.filter((f) => {
                if (seen.has(f.quality)) return false;
                seen.add(f.quality);
                return true;
            });

            items.push({
                type: "video",
                title: media.type === "animated_gif" ? "GIF" : title,
                thumbnail: media.media_url_https ?? "",
                duration, formats: uniqueFormats,
                direct_url: null, audio_url: null,
                index: i,
            });
        } else if (media.type === "photo") {
            let photoUrl = media.media_url_https ?? "";
            if (photoUrl) photoUrl = photoUrl.replace(/\.\w+$/, "") + "?format=jpg&name=orig";

            items.push({
                type: "photo",
                title: "Photo",
                thumbnail: media.media_url_https ?? "",
                duration: null, formats: [],
                direct_url: photoUrl, audio_url: null,
                index: i,
            });
        }
    }

    if (items.length === 0) throw new Error("No media found in this tweet");

    return { platform: "twitter" as const, title, uploader, items, original_url: url };
}