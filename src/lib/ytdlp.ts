import { spawn, spawnSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { analyzeWithInstaloader } from "./instaloader";
import { analyzeWithCobalt } from "./cobalt";

// ─── Cookie Handling ──────────────────────────────────────────────────────────
// Cookies used for all platforms (YouTube, Instagram, Twitter/X, Facebook).
// Strategy: try with cookies first, retry without on non-auth failures.

import { resolve } from "path";

const COOKIES_FILE = resolve(process.cwd(), "cookies.txt");

// Realistic browser User-Agent — critical for Twitter/Facebook/Instagram
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function getCookieArgs(_tool: "yt-dlp" | "gallery-dl"): string[] {
    // 1. Prefer YTDLP_COOKIES environment variable (Base64 encoded)
    if (process.env.YTDLP_COOKIES) {
        try {
            const tempDir = process.env.TEMP || process.env.TMP || "/tmp";
            const tempCookieFile = join(tempDir, "cookies_temp.txt");
            writeFileSync(tempCookieFile, Buffer.from(process.env.YTDLP_COOKIES, 'base64').toString('utf8'));
            return ["--cookies", tempCookieFile];
        } catch (err) {
            console.error("Failed to decode YTDLP_COOKIES env var:", err);
        }
    }

    // 2. cookies.txt file in project root
    if (existsSync(COOKIES_FILE)) {
        return ["--cookies", COOKIES_FILE];
    }

    // 3. Try browser cookies
    const browsers = ["firefox", "edge", "brave", "chrome", "chromium", "opera"];
    for (const browser of browsers) {
        try {
            const check = spawnSync("yt-dlp", ["--cookies-from-browser", browser, "--version"], {
                timeout: 3000, stdio: "pipe",
            });
            if (check.status === 0) {
                return ["--cookies-from-browser", browser];
            }
        } catch { continue; }
    }

    return [];
}

function shouldUseCookies(platform: Platform): boolean {
    // Use cookies for all platforms that have them — Twitter/X now requires auth too
    return platform === "youtube" || platform === "instagram" || platform === "twitter" || platform === "facebook";
}

function isRetryableError(errorMsg: string): boolean {
    return errorMsg.includes("Could not copy") ||
        errorMsg.includes("cookie") ||
        errorMsg.includes("Cookie") ||
        errorMsg.includes("unable to copy cookie") ||
        errorMsg.includes("login") ||
        errorMsg.includes("Sign in") ||
        errorMsg.includes("HTTP Error 403") ||
        errorMsg.includes("HTTP Error 429") ||
        errorMsg.includes("Unsupported URL") ||
        errorMsg.includes("is not a valid URL");
}

// ─── Platform Detection ───────────────────────────────────────────────────────

export type Platform = "youtube" | "instagram" | "twitter" | "facebook" | "unknown";

const PLATFORM_PATTERNS: { platform: Platform; regex: RegExp }[] = [
    {
        platform: "youtube",
        regex: /(?:youtube\.com\/(?:watch|shorts|embed|live)|youtu\.be\/)/i,
    },
    {
        platform: "instagram",
        regex: /(?:instagram\.com\/(?:p|reel|reels|tv|stories)\/)/i,
    },
    {
        platform: "twitter",
        regex: /(?:(?:twitter|x)\.com\/\w+\/status\/)/i,
    },
    {
        platform: "facebook",
        regex: /(?:facebook\.com\/(?:(?:.*\/)?(?:videos|posts|watch|reel|photo)|reel\/|share\/|watch\/)|fb\.watch\/)/i,
    },
];

export function detectPlatform(url: string): Platform {
    for (const { platform, regex } of PLATFORM_PATTERNS) {
        if (regex.test(url)) return platform;
    }
    return "unknown";
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MediaFormat {
    format_id: string;
    quality: string;
    ext: string;
    filesize: number | null;
    resolution: string | null;
    vcodec: string | null;
    acodec: string | null;
    height: number | null;
    fps: number | null;
    url: string | null;        // Direct CDN download URL
    has_audio: boolean;        // Whether this format includes audio
}

export interface MediaItem {
    type: "video" | "photo";
    title: string;
    thumbnail: string;
    duration: number | null;
    formats: MediaFormat[];
    direct_url: string | null; // For photos: direct image URL
    audio_url: string | null;  // Best audio stream URL (for separate video+audio)
    index: number;
}

export interface MediaInfo {
    platform: Platform;
    title: string;
    uploader: string;
    items: MediaItem[];
    original_url: string;
}

// ─── Analyze URL ──────────────────────────────────────────────────────────────
// Strategy: yt-dlp first for ALL platforms (returns CDN URLs = cross-device).
// Instagram: yt-dlp first → instaloader fallback.
// Twitter/Facebook: yt-dlp WITHOUT cookies.

export async function analyzeUrl(url: string): Promise<MediaInfo> {
    const platform = detectPlatform(url);

    // ── YouTube: yt-dlp first, Cobalt fallback ──
    if (platform === "youtube") {
        try {
            return await analyzeWithYtDlp(url, platform);
        } catch (ytdlpErr) {
            const ytdlpMsg = ytdlpErr instanceof Error ? ytdlpErr.message : "";
            console.error("yt-dlp failed for YouTube:", ytdlpMsg);

            // Fallback to Cobalt API (handles YouTube when yt-dlp signature is broken)
            try {
                console.log("[analyze] Trying Cobalt API fallback for YouTube...");
                const cobaltResult = await analyzeWithCobalt(url);
                if (cobaltResult.items.length > 0) return cobaltResult;
            } catch (cobaltErr) {
                const cobaltMsg = cobaltErr instanceof Error ? cobaltErr.message : "";
                console.error("Cobalt also failed:", cobaltMsg);
            }

            // Both failed — give clear error
            if (ytdlpMsg.includes("Sign in") || ytdlpMsg.includes("bot")) {
                throw new Error(
                    "YouTube requires authentication. " +
                    "Please update your cookies.txt with fresh YouTube cookies."
                );
            }
            throw new Error(`YouTube download failed. ${ytdlpMsg}`);
        }
    }

    // ── Instagram ──
    if (platform === "instagram") {
        const isStory = /instagram\.com\/stories\//i.test(url);

        // Try yt-dlp first
        let ytdlpError = "";
        try {
            const result = await analyzeWithYtDlp(url, platform);
            if (result.items.length > 0) return result;
            ytdlpError = "yt-dlp returned 0 items";
        } catch (err) {
            ytdlpError = err instanceof Error ? err.message : "yt-dlp failed";
            console.error("yt-dlp error for Instagram:", ytdlpError);
        }

        // Instaloader fallback (not for stories)
        if (!isStory) {
            try {
                const result = await analyzeWithInstaloader(url, platform);
                if (result.items.length > 0) return result;
            } catch (err) {
                const msg = err instanceof Error ? err.message : "";
                console.error("instaloader also failed:", msg);
            }
        }

        // If login/cookie error, give clear instructions
        if (ytdlpError.includes("login") || ytdlpError.includes("log in") || isStory) {
            throw new Error(
                `${isStory ? "Instagram Stories require" : "This Instagram post requires"} authentication. ` +
                "Please update your cookies.txt with fresh Instagram cookies. " +
                "Use the \"Get cookies.txt LOCALLY\" extension while logged into Instagram."
            );
        }

        throw new Error(
            `Could not extract media from this Instagram post. ` +
            `It may be private or unavailable. (${ytdlpError})`
        );
    }

    // ── Twitter/X & Facebook: analyze + pre-download to temp file for client proxy ──
    if (platform === "twitter" || platform === "facebook") {
        const result = await analyzeWithYtDlp(url, platform);

        // Pre-download the video to a temp file (m3u8 URLs expire too fast for proxy)
        // The client will then download from /api/serve-file which is a simple HTTP file
        try {
            const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
            const dlId = `mediagrab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const outPath = join(tmpDir, `${dlId}.mp4`);


            const dlArgs = [
                url,
                "-o", outPath,
                "--force-ipv4",
                "--no-warnings",
                "--no-playlist",
                "-f", "best[ext=mp4]/best",
                "--merge-output-format", "mp4",
            ];
            const cookieArgs = getCookieArgs("yt-dlp");
            dlArgs.push(...cookieArgs);

            await new Promise<void>((resolve, reject) => {
                const proc = spawn("yt-dlp", dlArgs);
                let stderr = "";
                proc.stderr?.on("data", (d) => { stderr += d.toString(); });
                proc.on("close", (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(stderr || `yt-dlp exit ${code}`));
                });
                proc.on("error", (err) => reject(err));
                setTimeout(() => { proc.kill(); reject(new Error("Pre-download timed out")); }, 120000);
            });

            // Replace all format URLs with the local serve-file URL
            const serveUrl = `/api/serve-file?path=${encodeURIComponent(outPath)}`;
            for (const item of result.items) {
                if (item.type === "video") {
                    if (item.formats.length > 0) {
                        // Keep only one format pointing to our downloaded file
                        const bestFormat = item.formats[0];
                        item.formats = [{
                            ...bestFormat,
                            url: serveUrl,
                            has_audio: true,
                            ext: "mp4",
                        }];
                    } else {
                        item.direct_url = serveUrl;
                    }
                }
            }
        } catch (err) {
            console.error("Pre-download failed:", err);
            // If pre-download fails, return original result (formats may have m3u8 URLs)
        }

        return result;
    }

    throw new Error("Unsupported platform. We support YouTube, Instagram, Twitter/X, and Facebook.");
}

// ─── Analyze with yt-dlp ──────────────────────────────────────────────────────

async function analyzeWithYtDlp(url: string, platform: Platform, withCookies?: boolean): Promise<MediaInfo> {
    // Default: use cookies only for YouTube/Instagram, NEVER for Twitter/Facebook
    if (withCookies === undefined) {
        withCookies = shouldUseCookies(platform);
    }

    return new Promise((resolve, reject) => {
        const args = [
            ...(withCookies ? getCookieArgs("yt-dlp") : []),
            "--dump-single-json",
            "--no-warnings",
            "--no-check-certificates",
            "--force-ipv4",
            "--user-agent", USER_AGENT,
            "--extractor-retries", "3",
            "--socket-timeout", "30",
        ];

        // YouTube-specific: use web player client to bypass bot detection
        if (platform === "youtube") {
            args.push("--extractor-args", "youtube:player_client=web");
        }

        args.push(url);

        console.log(`[analyze] ${platform}: yt-dlp ${withCookies ? "with" : "without"} cookies`);
        const proc = spawn("yt-dlp", args);
        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
        proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

        proc.on("close", (code) => {
            if (code !== 0) {
                console.error(`[analyze] yt-dlp failed (code ${code}) for ${platform}:`, stderr.substring(0, 500));

                // For auth errors ("Sign in", "login required") — DON'T retry without cookies
                // because the content genuinely needs authentication
                const isAuthError = stderr.includes("Sign in") ||
                    stderr.includes("login") ||
                    stderr.includes("log in") ||
                    stderr.includes("authentication");

                if (withCookies && !isAuthError) {
                    console.log(`[analyze] Retrying ${platform} without cookies...`);
                    analyzeWithYtDlp(url, platform, false).then(resolve, reject);
                    return;
                }
                reject(new Error(stderr || `yt-dlp exited with code ${code}`));
                return;
            }

            try {
                const data = JSON.parse(stdout);
                const items: MediaItem[] = [];

                if (data.entries && Array.isArray(data.entries)) {
                    data.entries.forEach((entry: Record<string, unknown>, idx: number) => {
                        const item = parseYtDlpEntry(entry, idx);
                        if (item) items.push(item);
                    });
                } else {
                    const item = parseYtDlpEntry(data, 0);
                    if (item) items.push(item);
                }

                resolve({
                    platform,
                    title: data.title || data.playlist_title || "Untitled",
                    uploader: data.uploader || data.channel || data.playlist_uploader || "Unknown",
                    items,
                    original_url: url,
                });
            } catch {
                reject(new Error("Failed to parse yt-dlp output"));
            }
        });

        proc.on("error", (err) => {
            reject(new Error(`Failed to run yt-dlp: ${err.message}. Is yt-dlp installed?`));
        });

        setTimeout(() => { proc.kill(); reject(new Error("yt-dlp timed out")); }, 90000);
    });
}

function parseYtDlpEntry(data: Record<string, unknown>, index: number): MediaItem | null {
    const formats: MediaFormat[] = ((data.formats as Record<string, unknown>[]) || [])
        .filter((f) => {
            // Must have video codec
            if (!f.vcodec || f.vcodec === "none") return false;
            // Must have a URL
            if (!f.url) return false;
            return true;
        })
        .map((f) => {
            const protocol = String(f.protocol || "");
            const url = String(f.url || "");
            // Prefer direct HTTP URLs for client-side proxy (m3u8 can't be proxied)
            const isDirectUrl = !url.includes(".m3u8") && !protocol.includes("m3u8");
            return {
                format_id: String(f.format_id || ""),
                quality: buildQualityLabel(f),
                ext: String(f.ext || "mp4"),
                filesize: (f.filesize as number) || (f.filesize_approx as number) || null,
                resolution: f.resolution ? String(f.resolution) : null,
                vcodec: f.vcodec ? String(f.vcodec) : null,
                acodec: f.acodec ? String(f.acodec) : null,
                height: (f.height as number) || null,
                fps: (f.fps as number) || null,
                url: url,
                has_audio: !!(f.acodec && f.acodec !== "none"),
                _isDirectUrl: isDirectUrl, // used for sorting only
            };
        })
        // Sort: highest quality first, then prefer direct HTTP URLs over m3u8
        .sort((a, b) => {
            const heightDiff = (b.height || 0) - (a.height || 0);
            if (heightDiff !== 0) return heightDiff;
            // At same height, prefer direct URLs
            if (a._isDirectUrl && !b._isDirectUrl) return -1;
            if (!a._isDirectUrl && b._isDirectUrl) return 1;
            return 0;
        })
        // Remove the internal sorting field
        .map(({ _isDirectUrl, ...f }) => f);

    // Deduplicate by quality label (not raw height, since e.g. 3840x1920 and 3840x2160 are both "4K")
    const seen = new Set<string>();
    const uniqueFormats = formats.filter((f) => {
        if (!f.quality || seen.has(f.quality)) return false;
        seen.add(f.quality);
        return true;
    });

    const finalFormats = uniqueFormats.length > 0 ? uniqueFormats : formats.length > 0 ? [formats[0]] : [];

    // Extract best audio-only stream URL for separate video+audio downloads
    let audioUrl: string | null = null;
    const audioFormats = ((data.formats as Record<string, unknown>[]) || [])
        .filter((f) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"))
        .sort((a, b) => ((b.abr as number) || 0) - ((a.abr as number) || 0));
    if (audioFormats.length > 0 && audioFormats[0].url) {
        audioUrl = String(audioFormats[0].url);
    }

    return {
        type: finalFormats.length > 0 ? "video" : "photo",
        title: String(data.title || data.description || "Untitled"),
        thumbnail: String(data.thumbnail || ""),
        duration: (data.duration as number) || null,
        formats: finalFormats,
        direct_url: finalFormats.length === 0 ? String(data.url || data.thumbnail || "") : null,
        audio_url: audioUrl,
        index,
    };
}

function buildQualityLabel(f: Record<string, unknown>): string {
    const height = f.height as number;
    const width = f.width as number;
    const formatNote = String(f.format_note || "").toLowerCase();

    if (!height) return String(f.format_note || f.resolution || "Unknown");

    // Check yt-dlp's own format_note first for accurate labeling
    // (handles 360° videos, ultrawide, etc. where height alone is misleading)
    if (formatNote.includes("4320") || formatNote.includes("8k")) return "8K";
    if (formatNote.includes("2160") || formatNote.includes("4k")) return "4K";

    // Also check width — e.g. 3840x1920 (360° video) is still 4K
    if (width >= 7680 || height >= 4320) return "8K";
    if (width >= 3840 || height >= 2160) return "4K";
    if (width >= 2560 || height >= 1440) return "1440p";
    if (height >= 1080) return "1080p";
    if (height >= 720) return "720p";
    if (height >= 480) return "480p";
    if (height >= 360) return "360p";
    if (height >= 240) return "240p";
    return `${height}p`;
}

// ─── Analyze with gallery-dl ──────────────────────────────────────────────────

async function analyzeWithGalleryDl(url: string, platform: Platform, withCookies = true): Promise<MediaInfo> {
    return new Promise((resolve, reject) => {
        // -j outputs a single JSON array with all entries
        const args = [...(withCookies ? getCookieArgs("gallery-dl") : []), "-j", url];
        const proc = spawn("gallery-dl", args);
        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
        proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

        proc.on("close", (code) => {
            console.log("gallery-dl exit code:", code);
            console.log("gallery-dl stderr:", stderr);
            console.log("gallery-dl stdout length:", stdout.length);

            if (code !== 0 && !stdout.trim()) {
                // If cookie-related error, retry without cookies
                if (withCookies && isRetryableError(stderr)) {
                    console.log("gallery-dl error detected, retrying without cookies...");
                    analyzeWithGalleryDl(url, platform, false).then(resolve, reject);
                    return;
                }
                reject(new Error(stderr || `gallery-dl exited with code ${code}`));
                return;
            }

            try {
                const items: MediaItem[] = [];
                let postTitle = "Post";
                let postUploader = "Unknown";

                // gallery-dl -j outputs a single JSON array: [[type, data], [type, data], ...]
                let entries: unknown[];
                try {
                    entries = JSON.parse(stdout.trim());
                } catch {
                    // Sometimes gallery-dl outputs multiple JSON arrays on separate lines
                    entries = [];
                    const lines = stdout.trim().split("\n").filter(Boolean);
                    for (const line of lines) {
                        try {
                            const parsed = JSON.parse(line.trim());
                            if (Array.isArray(parsed)) {
                                // Could be the outer array itself or individual entries
                                if (parsed.length > 0 && Array.isArray(parsed[0])) {
                                    entries.push(...parsed);
                                } else {
                                    entries.push(parsed);
                                }
                            }
                        } catch {
                            continue;
                        }
                    }
                }

                if (!Array.isArray(entries)) {
                    reject(new Error("gallery-dl returned unexpected format"));
                    return;
                }

                // Process each entry
                for (const entry of entries) {
                    if (!Array.isArray(entry)) continue;
                    const arr = entry as unknown[];

                    // Directory/category entries: [number, metadata]
                    if (typeof arr[0] === "number" && arr.length >= 2) {
                        const meta = arr[1] as Record<string, unknown>;
                        if (meta) {
                            postUploader = String(meta.username || meta.owner || meta.user || meta.uploader || meta.fullname || postUploader);
                            const desc = String(meta.description || meta.title || meta.caption || "");
                            if (desc && desc !== "undefined" && desc !== "null") {
                                postTitle = desc.length > 100 ? desc.substring(0, 100) + "..." : desc;
                            }
                        }
                        continue;
                    }

                    // Media entries: [url_string, metadata]
                    if (typeof arr[0] === "string" && arr.length >= 2) {
                        const mediaUrl = arr[0] as string;
                        const meta = (arr[1] || {}) as Record<string, unknown>;

                        // Determine media type from extension
                        const extension = String(meta.extension || "").toLowerCase();
                        const filename = String(meta.filename || "").toLowerCase();
                        const fullUrl = mediaUrl.toLowerCase();

                        const videoExts = ["mp4", "webm", "mov", "avi", "mkv", "m4v"];
                        const photoExts = ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "bmp"];

                        const isVideo = videoExts.includes(extension) ||
                            videoExts.some(e => fullUrl.includes(`.${e}`)) ||
                            videoExts.some(e => filename.endsWith(`.${e}`));
                        const isPhoto = photoExts.includes(extension) ||
                            photoExts.some(e => fullUrl.includes(`.${e}`)) ||
                            photoExts.some(e => filename.endsWith(`.${e}`));

                        // If we can't determine type, try to infer from URL patterns
                        const isMediaFile = isVideo || isPhoto ||
                            mediaUrl.includes("scontent") || // Instagram CDN
                            mediaUrl.includes("pbs.twimg.com") || // Twitter CDN
                            mediaUrl.includes("fbcdn"); // Facebook CDN

                        if (!isMediaFile) continue;

                        // Default to photo if not clearly video
                        const mediaType = isVideo ? "video" : "photo";

                        // Extract uploader from metadata
                        if (postUploader === "Unknown") {
                            postUploader = String(meta.username || meta.owner || meta.user || meta.fullname || "Unknown");
                        }
                        if (postTitle === "Post") {
                            const desc = String(meta.description || meta.title || meta.caption || "");
                            if (desc && desc !== "undefined" && desc !== "null") {
                                postTitle = desc.length > 100 ? desc.substring(0, 100) + "..." : desc;
                            }
                        }

                        items.push({
                            type: mediaType,
                            title: String(meta.description || meta.title || `Item ${items.length + 1}`).substring(0, 100),
                            thumbnail: String(meta.thumbnail || meta.display_url || (mediaType === "photo" ? mediaUrl : "") || ""),
                            duration: (meta.duration as number) || null,
                            formats: isVideo
                                ? [{
                                    format_id: "best",
                                    quality: meta.height ? buildQualityLabel({ height: meta.height }) : "Best",
                                    ext: extension || "mp4",
                                    filesize: (meta.filesize as number) || null,
                                    resolution: meta.width && meta.height ? `${meta.width}x${meta.height}` : null,
                                    vcodec: null,
                                    acodec: null,
                                    height: (meta.height as number) || null,
                                    fps: null,
                                    url: mediaUrl,
                                    has_audio: true,
                                }]
                                : [],
                            direct_url: mediaUrl,
                            audio_url: null,
                            index: items.length,
                        });
                    }
                }

                console.log(`gallery-dl parsed ${items.length} items for ${url}`);

                resolve({
                    platform,
                    title: postTitle,
                    uploader: postUploader,
                    items,
                    original_url: url,
                });
            } catch (err) {
                console.error("gallery-dl parse error:", err);
                reject(new Error("Failed to parse gallery-dl output"));
            }
        });

        proc.on("error", (err) => {
            reject(new Error(`gallery-dl not found: ${err.message}. Install it with: pip install gallery-dl`));
        });

        setTimeout(() => { proc.kill(); reject(new Error("gallery-dl timed out")); }, 90000);
    });
}

// ─── Progress Tracking ────────────────────────────────────────────────────────

export interface DownloadProgress {
    percent: number;
    speed: string;
    eta: string;
    status: "downloading" | "merging" | "complete" | "error";
    currentItem?: number;
    totalItems?: number;
}

const progressStore = new Map<string, DownloadProgress>();

export function setProgress(id: string, progress: DownloadProgress) {
    progressStore.set(id, progress);
}

export function getProgress(id: string): DownloadProgress | null {
    return progressStore.get(id) || null;
}

export function clearProgress(id: string) {
    progressStore.delete(id);
}

// ─── Download Video (yt-dlp) ──────────────────────────────────────────────────

export function downloadVideo(
    url: string,
    formatId: string,
    downloadId: string,
): Promise<{ filePath: string; filename: string }> {
    return new Promise((resolve, reject) => {
        const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
        const outTemplate = `${tmpDir}/mediagrab_${downloadId}.%(ext)s`;

        // Prioritize H.264/VP9 for best compatibility with high quality (1080p-1440p)
        const defaultFormat = "bestvideo[height<=1440][ext=mp4]+bestaudio[ext=m4a]/best[height<=1440]/best";

        const args = [
            ...getCookieArgs("yt-dlp"),
            "-f",
            formatId ? `${formatId}+bestaudio/best/${formatId}` : defaultFormat,
            "--merge-output-format",
            "mp4",
            "--no-warnings",
            "--no-check-certificates",
            "--force-ipv4",
            "--user-agent", USER_AGENT,
            "--extractor-retries", "3",
            "--extractor-args", "youtube:player_client=web",
            "--newline",
            "-o",
            outTemplate,
            url,
        ];

        const proc = spawn("yt-dlp", args);
        let lastFile = "";

        proc.stdout.on("data", (chunk) => {
            const line = chunk.toString();
            const progressMatch = line.match(
                /\[download\]\s+([\d.]+)%\s+of.*?at\s+([\d.]+\w+\/s).*?ETA\s+(\S+)/
            );
            if (progressMatch) {
                setProgress(downloadId, {
                    percent: parseFloat(progressMatch[1]),
                    speed: progressMatch[2],
                    eta: progressMatch[3],
                    status: "downloading",
                });
            }
            if (line.includes("[Merger]") || line.includes("[ffmpeg]")) {
                setProgress(downloadId, { percent: 100, speed: "", eta: "", status: "merging" });
            }
            const destMatch = line.match(/\[(?:download|Merger)\].*?Destination:\s*(.+)/);
            if (destMatch) lastFile = destMatch[1].trim();
            const mergeMatch = line.match(/Merging formats into "(.+)"/);
            if (mergeMatch) lastFile = mergeMatch[1].trim();
        });

        proc.stderr.on("data", (chunk) => { console.error("yt-dlp stderr:", chunk.toString()); });

        proc.on("close", (code) => {
            if (code !== 0) {
                setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
                reject(new Error(`yt-dlp exited with code ${code}`));
                return;
            }
            setProgress(downloadId, { percent: 100, speed: "", eta: "", status: "complete" });

            const extensions = ["mp4", "webm", "mkv", "mp3", "m4a"];
            let outputFile = lastFile;
            if (!outputFile || !existsSync(outputFile)) {
                for (const ext of extensions) {
                    const candidate = `${tmpDir}/mediagrab_${downloadId}.${ext}`;
                    if (existsSync(candidate)) { outputFile = candidate; break; }
                }
            }
            if (!outputFile || !existsSync(outputFile)) {
                reject(new Error("Download completed but output file not found"));
                return;
            }
            const { basename } = require("path");
            resolve({ filePath: outputFile, filename: basename(outputFile) });
        });

        proc.on("error", (err) => {
            setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
            reject(new Error(`Failed to run yt-dlp: ${err.message}`));
        });

        setTimeout(() => { proc.kill(); reject(new Error("Download timed out")); }, 300000);
    });
}

// ─── Download Audio Only (yt-dlp) ─────────────────────────────────────────────

export function downloadAudio(
    url: string,
    downloadId: string,
): Promise<{ filePath: string; filename: string }> {
    return new Promise((resolve, reject) => {
        const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
        const outTemplate = `${tmpDir}/mediagrab_audio_${downloadId}.%(ext)s`;

        const args = [
            ...getCookieArgs("yt-dlp"),
            "-f", "bestaudio",
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "0",  // best quality
            "--no-warnings",
            "--no-check-certificates",
            "--force-ipv4",
            "--user-agent", USER_AGENT,
            "--extractor-retries", "3",
            "--newline",
            "-o",
            outTemplate,
            url,
        ];

        const proc = spawn("yt-dlp", args);
        let lastFile = "";

        proc.stdout.on("data", (chunk) => {
            const line = chunk.toString();
            const progressMatch = line.match(
                /\[download\]\s+([\d.]+)%\s+of.*?at\s+([\d.]+\w+\/s).*?ETA\s+(\S+)/
            );
            if (progressMatch) {
                setProgress(downloadId, {
                    percent: parseFloat(progressMatch[1]),
                    speed: progressMatch[2],
                    eta: progressMatch[3],
                    status: "downloading",
                });
            }
            if (line.includes("[ffmpeg]") || line.includes("[ExtractAudio]")) {
                setProgress(downloadId, { percent: 95, speed: "", eta: "", status: "merging" });
            }
            const destMatch = line.match(/\[(?:download|ffmpeg|ExtractAudio)\].*?Destination:\s*(.+)/);
            if (destMatch) lastFile = destMatch[1].trim();
        });

        proc.stderr.on("data", (chunk) => { console.error("yt-dlp audio stderr:", chunk.toString()); });

        proc.on("close", (code) => {
            if (code !== 0) {
                setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
                reject(new Error(`yt-dlp audio exited with code ${code}`));
                return;
            }
            setProgress(downloadId, { percent: 100, speed: "", eta: "", status: "complete" });

            const extensions = ["mp3", "m4a", "opus", "ogg", "wav", "webm"];
            let outputFile = lastFile;
            if (!outputFile || !existsSync(outputFile)) {
                for (const ext of extensions) {
                    const candidate = `${tmpDir}/mediagrab_audio_${downloadId}.${ext}`;
                    if (existsSync(candidate)) { outputFile = candidate; break; }
                }
            }
            if (!outputFile || !existsSync(outputFile)) {
                reject(new Error("Audio download completed but output file not found"));
                return;
            }
            const { basename } = require("path");
            resolve({ filePath: outputFile, filename: basename(outputFile) });
        });

        proc.on("error", (err) => {
            setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
            reject(new Error(`Failed to run yt-dlp: ${err.message}`));
        });

        setTimeout(() => { proc.kill(); reject(new Error("Audio download timed out")); }, 300000);
    });
}


export async function downloadPhoto(
    imageUrl: string,
    downloadId: string,
): Promise<{ filePath: string; filename: string }> {
    setProgress(downloadId, { percent: 10, speed: "", eta: "", status: "downloading" });

    // Build platform-appropriate headers based on CDN URL
    const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    };

    // Add Referer based on CDN origin
    if (imageUrl.includes("pbs.twimg.com") || imageUrl.includes("ton.twitter.com")) {
        headers["Referer"] = "https://x.com/";
    } else if (imageUrl.includes("fbcdn") || imageUrl.includes("facebook.com") || imageUrl.includes("fb.com")) {
        headers["Referer"] = "https://www.facebook.com/";
    } else if (imageUrl.includes("cdninstagram") || imageUrl.includes("scontent")) {
        headers["Referer"] = "https://www.instagram.com/";
    }

    const response = await fetch(imageUrl, { headers });

    if (!response.ok) {
        setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
        throw new Error(`Failed to download image: ${response.statusText}`);
    }

    setProgress(downloadId, { percent: 50, speed: "", eta: "", status: "downloading" });

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const extMap: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
        "video/mp4": "mp4",
    };
    const ext = extMap[contentType] || "jpg";
    const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
    const filePath = join(tmpDir, `mediagrab_${downloadId}.${ext}`);

    writeFileSync(filePath, buffer);

    setProgress(downloadId, { percent: 100, speed: "", eta: "", status: "complete" });
    return { filePath, filename: `photo_${downloadId}.${ext}` };
}

// ─── Download with gallery-dl ─────────────────────────────────────────────────

export function downloadWithGalleryDl(
    url: string,
    downloadId: string,
    itemIndex?: number,
): Promise<{ filePath: string; filename: string; isZip?: boolean }> {
    return new Promise((resolve, reject) => {
        const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
        const outDir = join(tmpDir, `mediagrab_gdl_${downloadId}`);

        // Create output directory
        mkdirSync(outDir, { recursive: true });

        const args = [
            ...getCookieArgs("gallery-dl"),
            "--dest", outDir,
            "--filename", "{num:>02}.{extension}",
            "--no-mtime",
            url,
        ];

        // If specific item index, use range
        if (itemIndex !== undefined) {
            args.splice(0, 0, "--range", `${itemIndex + 1}`);
        }

        const proc = spawn("gallery-dl", args);
        let fileCount = 0;

        setProgress(downloadId, { percent: 10, speed: "", eta: "", status: "downloading" });

        proc.stdout.on("data", (chunk) => {
            const line = chunk.toString();
            if (line.includes("/")) {
                fileCount++;
                setProgress(downloadId, {
                    percent: Math.min(90, 10 + fileCount * 20),
                    speed: "",
                    eta: "",
                    status: "downloading",
                });
            }
        });

        proc.stderr.on("data", (chunk) => { console.error("gallery-dl stderr:", chunk.toString()); });

        proc.on("close", (code) => {
            if (code !== 0) {
                setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
                reject(new Error(`gallery-dl exited with code ${code}`));
                return;
            }

            // Find downloaded files
            const files = findFilesRecursive(outDir);
            if (files.length === 0) {
                reject(new Error("No files were downloaded"));
                return;
            }

            setProgress(downloadId, { percent: 100, speed: "", eta: "", status: "complete" });

            if (files.length === 1) {
                // Single file
                const { basename } = require("path");
                resolve({ filePath: files[0], filename: basename(files[0]) });
            } else {
                // Multiple files — we'll zip them
                // For now, return first file; the API route handles multi-file zipping
                const { basename } = require("path");
                resolve({
                    filePath: outDir,
                    filename: `mediagrab_${downloadId}`,
                    isZip: true,
                });
            }
        });

        proc.on("error", (err) => {
            setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
            reject(new Error(`Failed to run gallery-dl: ${err.message}`));
        });

        setTimeout(() => { proc.kill(); reject(new Error("Download timed out")); }, 300000);
    });
}

function findFilesRecursive(dir: string): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findFilesRecursive(fullPath));
        } else {
            results.push(fullPath);
        }
    }
    return results;
}
