import { spawn } from "child_process";
import { mkdirSync, existsSync, readdirSync, readFileSync, unlinkSync } from "fs";
import { join, basename, extname } from "path";
import { execSync } from "child_process";
import type { MediaInfo, MediaItem, Platform } from "./ytdlp";
import { setProgress } from "./ytdlp";

// ─── Instaloader: Instagram Photos & Carousels ───────────────────────────────

/**
 * Extract the shortcode from an Instagram URL.
 * e.g. https://www.instagram.com/p/ABC123/ → ABC123
 */
function extractShortcode(url: string): string | null {
    const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
}

/**
 * Analyze an Instagram URL using instaloader.
 * Instaloader excels at extracting photos and carousels (slideshows).
 * For videos, we let the caller fall back to yt-dlp.
 */
export async function analyzeWithInstaloader(
    url: string,
    platform: Platform,
): Promise<MediaInfo> {
    const shortcode = extractShortcode(url);
    if (!shortcode) {
        throw new Error("Could not extract Instagram shortcode from URL");
    }

    return new Promise((resolve, reject) => {
        const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
        const outDir = join(tmpDir, `mediagrab_insta_analyze_${shortcode}`);

        // Clean up any previous attempt
        if (existsSync(outDir)) {
            try {
                const { rmSync } = require("fs");
                rmSync(outDir, { recursive: true, force: true });
            } catch { /* ignore */ }
        }
        mkdirSync(outDir, { recursive: true });

        // instaloader downloads the post to a directory
        // --no-video-thumbnails: skip video thumbnail JPGs
        // --no-captions: skip caption .txt files
        // --no-metadata-json: we don't need the JSON metadata for analyze
        // --no-compress-json: don't compress
        // --dirname-pattern: flatten into our output dir
        // --filename-pattern: use predictable filenames
        const args = [
            "--no-video-thumbnails",
            "--no-captions",
            "--no-metadata-json",
            "--no-compress-json",
            "--dirname-pattern", outDir,
            "--filename-pattern", "{shortcode}_{mediaid}",
            "--", `-${shortcode}`,  // the -- prefix downloads a single post by shortcode
        ];

        const proc = spawn("instaloader", args);
        let stderr = "";

        proc.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        proc.stdout.on("data", (chunk) => {
            // instaloader logs to stdout too, we just consume it
            console.log("instaloader:", chunk.toString().trim());
        });

        proc.on("close", (code) => {
            console.log("instaloader exit code:", code, "stderr:", stderr);

            // Scan downloaded files
            const items: MediaItem[] = [];
            let uploader = "Unknown";

            try {
                if (existsSync(outDir)) {
                    const files = readdirSync(outDir).filter((f) => {
                        const ext = extname(f).toLowerCase();
                        return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov"].includes(ext);
                    }).sort();

                    for (let i = 0; i < files.length; i++) {
                        const filePath = join(outDir, files[i]);
                        const ext = extname(files[i]).toLowerCase();
                        const videoExts = [".mp4", ".webm", ".mov"];
                        const isVideo = videoExts.includes(ext);

                        // Generate thumbnail
                        let thumbnail = "";
                        if (!isVideo) {
                            // Photos: read file directly as base64
                            try {
                                const imgBuffer = readFileSync(filePath);
                                const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
                                thumbnail = `data:${mimeType};base64,${imgBuffer.toString("base64")}`;
                            } catch {
                                thumbnail = "";
                            }
                        } else {
                            // Videos: use ffmpeg to extract a frame at 1 second
                            const thumbPath = `${filePath}.thumb.jpg`;
                            try {
                                execSync(
                                    `ffmpeg -y -i "${filePath}" -ss 00:00:01 -vframes 1 -vf scale=480:-1 -q:v 5 "${thumbPath}"`,
                                    { stdio: "pipe", timeout: 15000 }
                                );
                                if (existsSync(thumbPath)) {
                                    const imgBuffer = readFileSync(thumbPath);
                                    thumbnail = `data:image/jpeg;base64,${imgBuffer.toString("base64")}`;
                                    try { unlinkSync(thumbPath); } catch { /* ignore */ }
                                }
                            } catch {
                                // ffmpeg not available or failed — leave thumbnail empty
                                try { if (existsSync(thumbPath)) unlinkSync(thumbPath); } catch { /* ignore */ }
                            }
                        }

                        // Photos: use base64 data URL (already in thumbnail) so download is 100% client-side
                        // Videos: use /api/serve-file since video data is too large for base64
                        const videoServeUrl = `/api/serve-file?path=${encodeURIComponent(filePath)}`;

                        items.push({
                            type: isVideo ? "video" : "photo",
                            title: `Item ${i + 1}`,
                            thumbnail,
                            duration: null,
                            formats: isVideo
                                ? [{
                                    format_id: "best",
                                    quality: "Best",
                                    ext: ext.slice(1),
                                    filesize: null,
                                    resolution: null,
                                    vcodec: null,
                                    acodec: null,
                                    height: null,
                                    fps: null,
                                    url: videoServeUrl,
                                    has_audio: true,
                                }]
                                : [],
                            direct_url: isVideo ? videoServeUrl : thumbnail,
                            audio_url: null,
                            index: i,
                        });
                    }

                    // Try to extract username from stderr output
                    const userMatch = stderr.match(/(?:@|from\s+)(\w+)/i);
                    if (userMatch) uploader = userMatch[1];
                }
            } catch (err) {
                console.error("Error scanning instaloader output:", err);
            }

            if (items.length === 0 && code !== 0) {
                reject(new Error(stderr || `instaloader exited with code ${code}`));
                return;
            }

            // Even if code != 0, if we got items, return them
            resolve({
                platform,
                title: `Instagram Post ${shortcode}`,
                uploader,
                items,
                original_url: url,
            });
        });

        proc.on("error", (err) => {
            reject(new Error(`instaloader not found: ${err.message}. Install it with: pip install instaloader`));
        });

        setTimeout(() => {
            proc.kill();
            reject(new Error("instaloader timed out"));
        }, 60000);
    });
}

/**
 * Download media from an Instagram post using instaloader.
 */
export function downloadWithInstaloader(
    url: string,
    downloadId: string,
    itemIndex?: number,
): Promise<{ filePath: string; filename: string; isZip?: boolean }> {
    const shortcode = extractShortcode(url);
    if (!shortcode) {
        return Promise.reject(new Error("Could not extract Instagram shortcode from URL"));
    }

    return new Promise((resolve, reject) => {
        const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
        const outDir = join(tmpDir, `mediagrab_insta_${downloadId}`);

        mkdirSync(outDir, { recursive: true });

        const args = [
            "--no-video-thumbnails",
            "--no-captions",
            "--no-metadata-json",
            "--no-compress-json",
            "--dirname-pattern", outDir,
            "--filename-pattern", "{shortcode}_{mediaid}",
            "--", `-${shortcode}`,
        ];

        const proc = spawn("instaloader", args);

        setProgress(downloadId, { percent: 10, speed: "", eta: "", status: "downloading" });

        proc.stdout.on("data", (chunk) => {
            const line = chunk.toString();
            console.log("instaloader download:", line.trim());
            // Update progress incrementally
            setProgress(downloadId, {
                percent: Math.min(80, 10 + Math.random() * 30),
                speed: "",
                eta: "",
                status: "downloading",
            });
        });

        proc.stderr.on("data", (chunk) => {
            console.error("instaloader stderr:", chunk.toString());
        });

        proc.on("close", (code) => {
            if (code !== 0) {
                setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
                reject(new Error(`instaloader exited with code ${code}`));
                return;
            }

            // Find downloaded files
            let files: string[] = [];
            try {
                if (existsSync(outDir)) {
                    files = readdirSync(outDir)
                        .filter((f) => {
                            const ext = extname(f).toLowerCase();
                            return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov"].includes(ext);
                        })
                        .sort()
                        .map((f) => join(outDir, f));
                }
            } catch { /* ignore */ }

            if (files.length === 0) {
                setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
                reject(new Error("No files were downloaded by instaloader"));
                return;
            }

            setProgress(downloadId, { percent: 100, speed: "", eta: "", status: "complete" });

            // If a specific item was requested
            if (itemIndex !== undefined && itemIndex < files.length) {
                resolve({
                    filePath: files[itemIndex],
                    filename: basename(files[itemIndex]),
                });
                return;
            }

            // Single file
            if (files.length === 1) {
                resolve({
                    filePath: files[0],
                    filename: basename(files[0]),
                });
                return;
            }

            // Multiple files — return directory for multi-download
            resolve({
                filePath: outDir,
                filename: `mediagrab_insta_${downloadId}`,
                isZip: true,
            });
        });

        proc.on("error", (err) => {
            setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
            reject(new Error(`Failed to run instaloader: ${err.message}`));
        });

        setTimeout(() => {
            proc.kill();
            reject(new Error("instaloader download timed out"));
        }, 300000);
    });
}
