/**
 * Twitter/X video scraper — uses Twitter's internal GraphQL API.
 * No yt-dlp, no external dependencies, no API keys needed.
 *
 * How it works:
 * 1. Obtain a guest token from api.x.com/1.1/guest/activate.json
 * 2. Query TweetResultByRestId GraphQL endpoint with guest token
 * 3. Extract direct mp4 URLs from video_info.variants
 *
 * Returns direct CDN URLs (video.twimg.com) that can be proxied to the client.
 * All mp4 variants include audio — no FFmpeg merging needed.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const BEARER_TOKEN =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const GRAPHQL_ENDPOINT =
    "https://x.com/i/api/graphql/0hWvDhmW8YQ-S_ib3azIrw/TweetResultByRestId";

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ─── Extract tweet ID from URL ────────────────────────────────────────────────

export function extractTweetId(url: string): string | null {
    const match = url.match(/(?:twitter|x)\.com\/\w+\/status\/(\d+)/i);
    return match ? match[1] : null;
}

// ─── Guest token cache ────────────────────────────────────────────────────────

let cachedGuestToken: { token: string; expiry: number } | null = null;

async function getGuestToken(): Promise<string> {
    if (cachedGuestToken && Date.now() < cachedGuestToken.expiry) {
        return cachedGuestToken.token;
    }

    const res = await fetch("https://api.x.com/1.1/guest/activate.json", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${BEARER_TOKEN}`,
            "User-Agent": USER_AGENT,
        },
    });

    if (!res.ok) {
        throw new Error(`Failed to get guest token: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { guest_token?: string };
    if (!data.guest_token) {
        throw new Error("No guest token in response");
    }

    cachedGuestToken = {
        token: data.guest_token,
        expiry: Date.now() + 60 * 60 * 1000, // 1 hour
    };

    console.log("[twitter-scraper] Got guest token:", data.guest_token.substring(0, 8) + "...");
    return data.guest_token;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TweetGraphQLResponse {
    data?: {
        tweetResult?: {
            result?: TweetResult;
        };
    };
}

interface TweetResult {
    __typename?: string;
    core?: {
        user_results?: {
            result?: {
                legacy?: {
                    name?: string;
                    screen_name?: string;
                };
            };
        };
    };
    legacy?: TweetLegacy;
    tweet?: TweetResult; // "TweetWithVisibilityResults" wrapper
}

interface TweetLegacy {
    full_text?: string;
    extended_entities?: {
        media?: TweetMedia[];
    };
    entities?: {
        media?: TweetMedia[];
    };
}

interface TweetMedia {
    type?: string;
    media_url_https?: string;
    video_info?: {
        duration_millis?: number;
        variants?: VideoVariant[];
    };
}

interface VideoVariant {
    bitrate?: number;
    content_type?: string;
    url?: string;
}

// ─── Fetch tweet via GraphQL ──────────────────────────────────────────────────

async function fetchTweetGraphQL(tweetId: string, guestToken: string): Promise<TweetGraphQLResponse> {
    const variables = JSON.stringify({
        tweetId,
        withCommunity: false,
        includePromotedContent: false,
        withVoice: false,
    });

    const url = `${GRAPHQL_ENDPOINT}?variables=${encodeURIComponent(variables)}`;

    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${BEARER_TOKEN}`,
            "X-Guest-Token": guestToken,
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json",
            Referer: "https://x.com/",
        },
    });

    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }

    return (await res.json()) as TweetGraphQLResponse;
}

async function fetchTweet(tweetId: string): Promise<TweetResult> {
    let guestToken = await getGuestToken();

    try {
        const data = await fetchTweetGraphQL(tweetId, guestToken);
        const result = data?.data?.tweetResult?.result;
        if (result) return result;
    } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        // If auth error, clear cache and retry with fresh token
        if (msg.includes("403") || msg.includes("401")) {
            cachedGuestToken = null;
            guestToken = await getGuestToken();
            const data = await fetchTweetGraphQL(tweetId, guestToken);
            const result = data?.data?.tweetResult?.result;
            if (result) return result;
        } else {
            throw new Error(`Twitter API error: ${msg}`);
        }
    }

    throw new Error("Tweet not found or unavailable");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildQualityLabel(height: number): string {
    if (height >= 2160) return "4K";
    if (height >= 1440) return "1440p";
    if (height >= 1080) return "1080p";
    if (height >= 720) return "720p";
    if (height >= 480) return "480p";
    if (height >= 360) return "360p";
    if (height >= 240) return "240p";
    return `${height}p`;
}

function extractResolution(url: string): { width: number; height: number } | null {
    // Twitter CDN URLs contain resolution: /vid/avc1/720x1280/ or /vid/1280x720/
    const match = url.match(/\/(\d{2,4})x(\d{2,4})\//);
    if (match) {
        const a = parseInt(match[1]);
        const b = parseInt(match[2]);
        return { width: Math.max(a, b), height: Math.min(a, b) };
    }
    return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface TwitterMediaFormat {
    format_id: string;
    quality: string;
    ext: string;
    filesize: number | null;
    resolution: string | null;
    vcodec: string | null;
    acodec: string | null;
    height: number | null;
    fps: number | null;
    url: string;
    has_audio: boolean;
}

export interface TwitterMediaItem {
    type: "video" | "photo";
    title: string;
    thumbnail: string;
    duration: number | null;
    formats: TwitterMediaFormat[];
    direct_url: string | null;
    audio_url: string | null;
    index: number;
}

export interface TwitterMediaInfo {
    platform: "twitter";
    title: string;
    uploader: string;
    items: TwitterMediaItem[];
    original_url: string;
}

export async function analyzeTwitterUrl(url: string): Promise<TwitterMediaInfo> {
    const tweetId = extractTweetId(url);
    if (!tweetId) throw new Error("Invalid Twitter/X URL");

    const result = await fetchTweet(tweetId);

    // Unwrap "TweetWithVisibilityResults" wrapper if present
    const tweet =
        result.__typename === "TweetWithVisibilityResults" && result.tweet
            ? result.tweet
            : result;

    const userLegacy = tweet.core?.user_results?.result?.legacy;
    const legacy = tweet.legacy;

    if (!legacy) {
        throw new Error("Tweet data not available (may be private or deleted)");
    }

    const uploader = userLegacy?.name || userLegacy?.screen_name || "Unknown";
    const text = legacy.full_text || "";
    const title = text.length > 100 ? text.substring(0, 97) + "..." : text || "Twitter Video";

    // Extract media from extended_entities (preferred) or entities
    const allMedia = legacy.extended_entities?.media || legacy.entities?.media || [];
    const items: TwitterMediaItem[] = [];

    for (let i = 0; i < allMedia.length; i++) {
        const media = allMedia[i];

        if (media.type === "video" || media.type === "animated_gif") {
            const variants = media.video_info?.variants || [];
            const duration = media.video_info?.duration_millis
                ? Math.round(media.video_info.duration_millis / 1000)
                : null;
            const thumbnail = media.media_url_https || "";

            // Filter to mp4 variants only (skip m3u8 HLS)
            const mp4Variants = variants
                .filter(
                    (v: VideoVariant) =>
                        v.content_type === "video/mp4" && v.url && !v.url.includes("m3u8")
                )
                .sort((a: VideoVariant, b: VideoVariant) => (b.bitrate || 0) - (a.bitrate || 0));

            const formats: TwitterMediaFormat[] = mp4Variants.map(
                (v: VideoVariant, idx: number) => {
                    const res = extractResolution(v.url || "");
                    const height = res ? res.height : 720;

                    return {
                        format_id: `tw_mp4_${idx}`,
                        quality: buildQualityLabel(height),
                        ext: "mp4",
                        filesize: null,
                        resolution: res ? `${res.width}x${res.height}` : null,
                        vcodec: "h264",
                        acodec: "aac",
                        height,
                        fps: null,
                        url: v.url || "",
                        has_audio: true, // Twitter mp4 variants always include audio
                    };
                }
            );

            // Deduplicate by quality label (keep highest bitrate = first in sorted)
            const seen = new Set<string>();
            const uniqueFormats = formats.filter((f) => {
                if (seen.has(f.quality)) return false;
                seen.add(f.quality);
                return true;
            });

            items.push({
                type: "video",
                title: media.type === "animated_gif" ? "GIF" : title,
                thumbnail,
                duration,
                formats: uniqueFormats,
                direct_url: null,
                audio_url: null, // Not needed — Twitter mp4 variants include audio
                index: i,
            });
        } else if (media.type === "photo") {
            let photoUrl = media.media_url_https || "";
            if (photoUrl && !photoUrl.includes("?format=")) {
                photoUrl = photoUrl.replace(/\.\w+$/, "") + "?format=jpg&name=orig";
                if (!photoUrl.startsWith("http")) {
                    photoUrl = media.media_url_https || "";
                }
            }

            items.push({
                type: "photo",
                title: "Photo",
                thumbnail: media.media_url_https || "",
                duration: null,
                formats: [],
                direct_url: photoUrl,
                audio_url: null,
                index: i,
            });
        }
    }

    if (items.length === 0) {
        throw new Error("No media found in this tweet");
    }

    return {
        platform: "twitter",
        title,
        uploader,
        items,
        original_url: url,
    };
}
