/**
 * Client-side FFmpeg helper using ffmpeg.wasm
 * Handles video+audio merging and audio extraction entirely in the browser.
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoading = false;
let ffmpegLoaded = false;

export type FFmpegProgress = {
    phase: "loading" | "downloading_video" | "downloading_audio" | "merging" | "converting" | "complete" | "error";
    percent: number;
    message: string;
};

/**
 * Load FFmpeg WASM (only once, cached)
 */
async function loadFFmpeg(onProgress?: (p: FFmpegProgress) => void): Promise<FFmpeg> {
    if (ffmpegInstance && ffmpegLoaded) return ffmpegInstance;
    if (ffmpegLoading) {
        // Wait for the in-progress load
        while (ffmpegLoading) {
            await new Promise(r => setTimeout(r, 100));
        }
        if (ffmpegInstance && ffmpegLoaded) return ffmpegInstance;
    }

    ffmpegLoading = true;
    onProgress?.({ phase: "loading", percent: 0, message: "Loading FFmpeg..." });

    try {
        const ffmpeg = new FFmpeg();
        // Use unpkg CDN for the core files
        const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
        await ffmpeg.load({
            coreURL: `${baseURL}/ffmpeg-core.js`,
            wasmURL: `${baseURL}/ffmpeg-core.wasm`,
        });
        ffmpegInstance = ffmpeg;
        ffmpegLoaded = true;
        onProgress?.({ phase: "loading", percent: 100, message: "FFmpeg loaded" });
        return ffmpeg;
    } catch (err) {
        ffmpegLoading = false;
        throw new Error(`Failed to load FFmpeg: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
        ffmpegLoading = false;
    }
}

/**
 * Download a file through the proxy and return as Uint8Array
 */
async function downloadViaProxy(
    cdnUrl: string,
    filename: string,
    onProgress?: (percent: number) => void,
): Promise<Uint8Array> {
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(cdnUrl)}&filename=${encodeURIComponent(filename)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Download failed (${res.status})`);
    }

    const contentLength = res.headers.get("Content-Length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    if (!res.body) {
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0 && onProgress) {
            onProgress(Math.round((received / total) * 100));
        }
    }

    // Combine chunks
    const result = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

/**
 * Merge separate video and audio streams into a single MP4 file.
 * Used for YouTube 1080p+ where video and audio are separate.
 */
export async function mergeVideoAudio(
    videoUrl: string,
    audioUrl: string,
    outputFilename: string,
    onProgress?: (p: FFmpegProgress) => void,
): Promise<Blob> {
    // 1. Load FFmpeg
    const ffmpeg = await loadFFmpeg(onProgress);

    // 2. Download video stream
    onProgress?.({ phase: "downloading_video", percent: 0, message: "Downloading video..." });
    const videoData = await downloadViaProxy(videoUrl, "video.mp4", (pct) => {
        onProgress?.({ phase: "downloading_video", percent: pct, message: `Downloading video... ${pct}%` });
    });

    // 3. Download audio stream
    onProgress?.({ phase: "downloading_audio", percent: 0, message: "Downloading audio..." });
    const audioData = await downloadViaProxy(audioUrl, "audio.m4a", (pct) => {
        onProgress?.({ phase: "downloading_audio", percent: pct, message: `Downloading audio... ${pct}%` });
    });

    // 4. Merge in browser using FFmpeg
    onProgress?.({ phase: "merging", percent: 0, message: "Merging video + audio..." });

    await ffmpeg.writeFile("input_video.mp4", videoData);
    await ffmpeg.writeFile("input_audio.m4a", audioData);

    // Track merge progress
    ffmpeg.on("progress", ({ progress }) => {
        onProgress?.({ phase: "merging", percent: Math.round(progress * 100), message: `Merging... ${Math.round(progress * 100)}%` });
    });

    await ffmpeg.exec([
        "-i", "input_video.mp4",
        "-i", "input_audio.m4a",
        "-c:v", "copy",      // Don't re-encode video — just copy
        "-c:a", "aac",       // Encode audio to AAC for MP4 compatibility
        "-shortest",
        outputFilename,
    ]);

    // 5. Read the output
    const outputData = await ffmpeg.readFile(outputFilename);

    // Cleanup temp files
    try {
        await ffmpeg.deleteFile("input_video.mp4");
        await ffmpeg.deleteFile("input_audio.m4a");
        await ffmpeg.deleteFile(outputFilename);
    } catch { /* ignore */ }

    onProgress?.({ phase: "complete", percent: 100, message: "Done!" });
    return new Blob([outputData as BlobPart], { type: "video/mp4" });
}

/**
 * Extract and convert audio to MP3 from a media URL.
 * Used for audio-only downloads.
 */
export async function extractAudio(
    audioUrl: string,
    outputFilename: string,
    onProgress?: (p: FFmpegProgress) => void,
): Promise<Blob> {
    // 1. Load FFmpeg
    const ffmpeg = await loadFFmpeg(onProgress);

    // 2. Download the audio stream
    onProgress?.({ phase: "downloading_audio", percent: 0, message: "Downloading audio..." });
    const audioData = await downloadViaProxy(audioUrl, "audio_source", (pct) => {
        onProgress?.({ phase: "downloading_audio", percent: pct, message: `Downloading audio... ${pct}%` });
    });

    // 3. Convert to MP3
    onProgress?.({ phase: "converting", percent: 0, message: "Converting to MP3..." });

    await ffmpeg.writeFile("input_audio", audioData);

    ffmpeg.on("progress", ({ progress }) => {
        onProgress?.({ phase: "converting", percent: Math.round(progress * 100), message: `Converting... ${Math.round(progress * 100)}%` });
    });

    await ffmpeg.exec([
        "-i", "input_audio",
        "-vn",                // No video
        "-codec:a", "libmp3lame",
        "-q:a", "0",          // Best quality
        outputFilename,
    ]);

    const outputData = await ffmpeg.readFile(outputFilename);

    try {
        await ffmpeg.deleteFile("input_audio");
        await ffmpeg.deleteFile(outputFilename);
    } catch { /* ignore */ }

    onProgress?.({ phase: "complete", percent: 100, message: "Done!" });
    return new Blob([outputData as BlobPart], { type: "audio/mpeg" });
}

/**
 * Simple proxy download — just download a CDN file through the proxy.
 * For combined video+audio formats or photos.
 */
export async function proxyDownload(
    cdnUrl: string,
    filename: string,
    onProgress?: (percent: number) => void,
): Promise<Blob> {
    const data = await downloadViaProxy(cdnUrl, filename, onProgress);
    // Determine MIME type from extension
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
        mp4: "video/mp4", webm: "video/webm",
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
        mp3: "audio/mpeg", m4a: "audio/mp4",
    };
    return new Blob([data as BlobPart], { type: mimeMap[ext || ""] || "application/octet-stream" });
}

/**
 * Check if a URL is an m3u8/HLS stream
 */
export function isM3u8Url(url: string): boolean {
    return url.includes(".m3u8") || url.includes("m3u8");
}

/**
 * Download an m3u8/HLS video stream client-side.
 * 1. Download m3u8 manifest via proxy
 * 2. Parse segment URLs
 * 3. Download all .ts segments
 * 4. Use FFmpeg.wasm to concatenate into MP4
 */
export async function downloadM3u8Video(
    m3u8Url: string,
    outputFilename: string,
    onProgress?: (p: FFmpegProgress) => void,
): Promise<Blob> {
    // 1. Load FFmpeg
    const ffmpeg = await loadFFmpeg(onProgress);

    // 2. Download the m3u8 manifest
    onProgress?.({ phase: "downloading_video", percent: 0, message: "Fetching stream info..." });
    const manifestData = await downloadViaProxy(m3u8Url, "manifest.m3u8");
    const manifestText = new TextDecoder().decode(manifestData);

    // 3. Parse the manifest - check if it's a master playlist or media playlist
    const lines = manifestText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    // Determine the base URL for resolving relative segment URLs
    const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);

    // Check if this is a master playlist (contains #EXT-X-STREAM-INF)
    const isMaster = lines.some(l => l.startsWith("#EXT-X-STREAM-INF"));

    let mediaPlaylistUrl = m3u8Url;
    let mediaManifestText = manifestText;

    if (isMaster) {
        // Pick the best quality variant (last stream URL is usually highest quality)
        const variantUrls: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
                // The next non-comment line is the URL
                for (let j = i + 1; j < lines.length; j++) {
                    if (!lines[j].startsWith("#")) {
                        variantUrls.push(lines[j]);
                        break;
                    }
                }
            }
        }

        if (variantUrls.length === 0) {
            throw new Error("No video streams found in m3u8 playlist");
        }

        // Use the last (highest bitrate) variant
        const bestVariant = variantUrls[variantUrls.length - 1];
        mediaPlaylistUrl = bestVariant.startsWith("http") ? bestVariant : baseUrl + bestVariant;

        // Download the media playlist
        const mediaData = await downloadViaProxy(mediaPlaylistUrl, "media.m3u8");
        mediaManifestText = new TextDecoder().decode(mediaData);
    }

    // 4. Extract segment URLs from the media playlist
    const mediaBaseUrl = mediaPlaylistUrl.substring(0, mediaPlaylistUrl.lastIndexOf("/") + 1);
    const mediaLines = mediaManifestText.split("\n").map(l => l.trim());
    const segmentUrls: string[] = [];

    for (const line of mediaLines) {
        if (line.length > 0 && !line.startsWith("#")) {
            const segUrl = line.startsWith("http") ? line : mediaBaseUrl + line;
            segmentUrls.push(segUrl);
        }
    }

    if (segmentUrls.length === 0) {
        throw new Error("No segments found in m3u8 playlist");
    }

    // 5. Download all segments
    onProgress?.({ phase: "downloading_video", percent: 5, message: `Downloading ${segmentUrls.length} segments...` });

    const segmentFiles: string[] = [];
    for (let i = 0; i < segmentUrls.length; i++) {
        const segFilename = `seg_${i.toString().padStart(4, "0")}.ts`;
        const segData = await downloadViaProxy(segmentUrls[i], segFilename);
        await ffmpeg.writeFile(segFilename, segData);
        segmentFiles.push(segFilename);

        const pct = 5 + Math.round((i / segmentUrls.length) * 70); // 5-75%
        onProgress?.({
            phase: "downloading_video",
            percent: pct,
            message: `Downloading segment ${i + 1}/${segmentUrls.length}...`,
        });
    }

    // 6. Create a concat file for FFmpeg
    const concatList = segmentFiles.map(f => `file '${f}'`).join("\n");
    await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(concatList));

    // 7. Merge segments into MP4 using FFmpeg
    onProgress?.({ phase: "merging", percent: 0, message: "Converting to MP4..." });

    ffmpeg.on("progress", ({ progress }) => {
        onProgress?.({
            phase: "merging",
            percent: Math.round(progress * 100),
            message: `Converting... ${Math.round(progress * 100)}%`,
        });
    });

    await ffmpeg.exec([
        "-f", "concat",
        "-safe", "0",
        "-i", "concat.txt",
        "-c:v", "copy",
        "-c:a", "copy",
        "-movflags", "+faststart",
        outputFilename,
    ]);

    // 8. Read output
    const outputData = await ffmpeg.readFile(outputFilename);

    // Cleanup
    try {
        for (const f of segmentFiles) await ffmpeg.deleteFile(f);
        await ffmpeg.deleteFile("concat.txt");
        await ffmpeg.deleteFile(outputFilename);
    } catch { /* ignore */ }

    onProgress?.({ phase: "complete", percent: 100, message: "Done!" });
    return new Blob([outputData as BlobPart], { type: "video/mp4" });
}
