/**
 * Client-side FFmpeg helper using ffmpeg.wasm
 * Handles video+audio merging and audio extraction entirely in the browser.
 * Optimised for large files (1440p / 4K).
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

export type FFmpegProgress = {
    phase:
    | "loading"
    | "downloading_video"
    | "downloading_audio"
    | "merging"
    | "converting"
    | "complete"
    | "error";
    percent: number;
    message: string;
};

// ─── Load FFmpeg (singleton, cached) ─────────────────────────────────────────

async function loadFFmpeg(
    onProgress?: (p: FFmpegProgress) => void
): Promise<FFmpeg> {
    if (ffmpegInstance) return ffmpegInstance;

    if (ffmpegLoadPromise) {
        onProgress?.({ phase: "loading", percent: 0, message: "Loading FFmpeg..." });
        return ffmpegLoadPromise;
    }

    ffmpegLoadPromise = (async () => {
        onProgress?.({ phase: "loading", percent: 0, message: "Loading FFmpeg..." });

        const ffmpeg = new FFmpeg();

        // Log FFmpeg output to console only (not UI)
        ffmpeg.on("log", ({ message }) => {
            if (process.env.NODE_ENV === "development") console.log("[ffmpeg]", message);
        });

        // Prefer jsDelivr CDN — faster and more reliable than unpkg for large WASM
        const baseURL =
            "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";

        await ffmpeg.load({
            coreURL: `${baseURL}/ffmpeg-core.js`,
            wasmURL: `${baseURL}/ffmpeg-core.wasm`,
        });

        ffmpegInstance = ffmpeg;
        onProgress?.({ phase: "loading", percent: 100, message: "FFmpeg ready" });
        return ffmpeg;
    })();

    try {
        return await ffmpegLoadPromise;
    } catch (err) {
        ffmpegLoadPromise = null; // allow retry on next call
        throw new Error(
            `Failed to load FFmpeg: ${err instanceof Error ? err.message : "unknown"}`
        );
    }
}

// ─── Download via proxy with progress ────────────────────────────────────────

async function downloadViaProxy(
    cdnUrl: string,
    filename: string,
    onProgress?: (percent: number) => void
): Promise<Uint8Array> {
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(cdnUrl)}&filename=${encodeURIComponent(filename)}`;

    const res = await fetch(proxyUrl);
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Proxy download failed (${res.status})`);
    }

    const contentLength = res.headers.get("Content-Length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    if (!res.body) {
        onProgress?.(100);
        return new Uint8Array(await res.arrayBuffer());
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0) {
            onProgress?.(Math.min(99, Math.round((received / total) * 100)));
        } else {
            // No content-length — pulse progress to show activity
            onProgress?.(Math.min(99, Math.round((received / (received + 1_000_000)) * 80)));
        }
    }

    onProgress?.(100);

    // Combine chunks efficiently
    const result = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

// ─── Estimate if merge is feasible given available RAM ───────────────────────

function checkMemoryFeasibility(videoBytes: number, audioBytes: number): void {
    // navigator.deviceMemory is in GB (Chrome only, optional)
    const deviceMemoryGB = (navigator as any).deviceMemory ?? 4;
    const deviceMemoryBytes = deviceMemoryGB * 1024 * 1024 * 1024;

    // We need ~3x the combined size in RAM (input + output + wasm overhead)
    const required = (videoBytes + audioBytes) * 3;

    if (required > deviceMemoryBytes * 0.6) {
        const requiredGB = (required / 1024 / 1024 / 1024).toFixed(1);
        const availableGB = ((deviceMemoryBytes * 0.6) / 1024 / 1024 / 1024).toFixed(1);
        console.warn(
            `[ffmpeg] RAM warning: need ~${requiredGB}GB, estimated available ~${availableGB}GB`
        );
        // Don't throw — just warn. Let the browser decide.
    }
}

// ─── Merge video + audio → MP4 ───────────────────────────────────────────────

export async function mergeVideoAudio(
    videoUrl: string,
    audioUrl: string,
    outputFilename: string,
    onProgress?: (p: FFmpegProgress) => void
): Promise<Blob> {
    // 1. Load FFmpeg
    const ffmpeg = await loadFFmpeg(onProgress);

    // 2. Download video stream
    onProgress?.({ phase: "downloading_video", percent: 0, message: "Downloading video stream..." });
    const videoData = await downloadViaProxy(videoUrl, "video_input.mp4", (pct) => {
        onProgress?.({
            phase: "downloading_video",
            percent: pct,
            message: `Downloading video... ${pct}%`,
        });
    });

    // 3. Download audio stream
    onProgress?.({ phase: "downloading_audio", percent: 0, message: "Downloading audio stream..." });
    const audioData = await downloadViaProxy(audioUrl, "audio_input.m4a", (pct) => {
        onProgress?.({
            phase: "downloading_audio",
            percent: pct,
            message: `Downloading audio... ${pct}%`,
        });
    });

    // Memory feasibility check (warn only)
    checkMemoryFeasibility(videoData.byteLength, audioData.byteLength);

    // 4. Write to FFmpeg virtual FS
    onProgress?.({ phase: "merging", percent: 0, message: "Merging streams..." });

    await ffmpeg.writeFile("v_in.mp4", videoData);
    await ffmpeg.writeFile("a_in.m4a", audioData);

    // Listen to FFmpeg progress events
    const progressHandler = ({ progress }: { progress: number }) => {
        onProgress?.({
            phase: "merging",
            percent: Math.round(Math.min(progress, 1) * 100),
            message: `Merging... ${Math.round(Math.min(progress, 1) * 100)}%`,
        });
    };
    ffmpeg.on("progress", progressHandler);

    try {
        await ffmpeg.exec([
            "-i", "v_in.mp4",
            "-i", "a_in.m4a",
            "-c:v", "copy",       // Copy video as-is (no re-encode — fast!)
            "-c:a", "aac",        // Re-encode audio to AAC for MP4 compatibility
            "-b:a", "192k",
            "-movflags", "+faststart", // Optimise for streaming/playback
            "-shortest",
            outputFilename,
        ]);
    } finally {
        ffmpeg.off("progress", progressHandler);
    }

    // 5. Read output
    const outputData = await ffmpeg.readFile(outputFilename);

    // Cleanup virtual FS to free RAM
    try {
        await ffmpeg.deleteFile("v_in.mp4");
        await ffmpeg.deleteFile("a_in.m4a");
        await ffmpeg.deleteFile(outputFilename);
    } catch { /* ignore */ }

    onProgress?.({ phase: "complete", percent: 100, message: "Done!" });
    return new Blob([outputData as BlobPart], { type: "video/mp4" });
}

// ─── Extract audio → MP3 ─────────────────────────────────────────────────────

export async function extractAudio(
    audioUrl: string,
    outputFilename: string,
    onProgress?: (p: FFmpegProgress) => void
): Promise<Blob> {
    const ffmpeg = await loadFFmpeg(onProgress);

    onProgress?.({ phase: "downloading_audio", percent: 0, message: "Downloading audio..." });
    const audioData = await downloadViaProxy(audioUrl, "audio_source", (pct) => {
        onProgress?.({
            phase: "downloading_audio",
            percent: pct,
            message: `Downloading audio... ${pct}%`,
        });
    });

    onProgress?.({ phase: "converting", percent: 0, message: "Converting to MP3..." });

    await ffmpeg.writeFile("audio_src", audioData);

    const progressHandler = ({ progress }: { progress: number }) => {
        onProgress?.({
            phase: "converting",
            percent: Math.round(Math.min(progress, 1) * 100),
            message: `Converting... ${Math.round(Math.min(progress, 1) * 100)}%`,
        });
    };
    ffmpeg.on("progress", progressHandler);

    try {
        await ffmpeg.exec([
            "-i", "audio_src",
            "-vn",
            "-codec:a", "libmp3lame",
            "-q:a", "0",          // VBR best quality (~320kbps)
            "-id3v2_version", "3",
            outputFilename,
        ]);
    } finally {
        ffmpeg.off("progress", progressHandler);
    }

    const outputData = await ffmpeg.readFile(outputFilename);

    try {
        await ffmpeg.deleteFile("audio_src");
        await ffmpeg.deleteFile(outputFilename);
    } catch { /* ignore */ }

    onProgress?.({ phase: "complete", percent: 100, message: "Done!" });
    return new Blob([outputData as BlobPart], { type: "audio/mpeg" });
}

// ─── Simple proxy download (combined formats / photos) ───────────────────────

export async function proxyDownload(
    cdnUrl: string,
    filename: string,
    onProgress?: (percent: number) => void
): Promise<Blob> {
    const data = await downloadViaProxy(cdnUrl, filename, onProgress);
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
        mp4: "video/mp4",
        webm: "video/webm",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
    };
    return new Blob([data as BlobPart], {
        type: mimeMap[ext] ?? "application/octet-stream",
    });
}

// ─── M3U8 / HLS stream download ──────────────────────────────────────────────

export function isM3u8Url(url: string): boolean {
    return url.includes(".m3u8") || url.includes("m3u8");
}

export async function downloadM3u8Video(
    m3u8Url: string,
    outputFilename: string,
    onProgress?: (p: FFmpegProgress) => void
): Promise<Blob> {
    const ffmpeg = await loadFFmpeg(onProgress);

    onProgress?.({ phase: "downloading_video", percent: 0, message: "Fetching stream info..." });
    const manifestData = await downloadViaProxy(m3u8Url, "manifest.m3u8");
    const manifestText = new TextDecoder().decode(manifestData);

    const lines = manifestText.split("\n").map((l) => l.trim()).filter(Boolean);
    const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);
    const isMaster = lines.some((l) => l.startsWith("#EXT-X-STREAM-INF"));

    let mediaPlaylistUrl = m3u8Url;
    let mediaManifestText = manifestText;

    if (isMaster) {
        const variantUrls: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
                for (let j = i + 1; j < lines.length; j++) {
                    if (!lines[j].startsWith("#")) {
                        variantUrls.push(lines[j]);
                        break;
                    }
                }
            }
        }
        if (variantUrls.length === 0) throw new Error("No streams found in m3u8");
        const best = variantUrls[variantUrls.length - 1];
        mediaPlaylistUrl = best.startsWith("http") ? best : baseUrl + best;
        const mediaData = await downloadViaProxy(mediaPlaylistUrl, "media.m3u8");
        mediaManifestText = new TextDecoder().decode(mediaData);
    }

    const mediaBaseUrl = mediaPlaylistUrl.substring(0, mediaPlaylistUrl.lastIndexOf("/") + 1);
    const mediaLines = mediaManifestText.split("\n").map((l) => l.trim());
    const segmentUrls: string[] = [];
    for (const line of mediaLines) {
        if (line.length > 0 && !line.startsWith("#")) {
            segmentUrls.push(line.startsWith("http") ? line : mediaBaseUrl + line);
        }
    }
    if (segmentUrls.length === 0) throw new Error("No segments found in m3u8");

    onProgress?.({ phase: "downloading_video", percent: 5, message: `Downloading ${segmentUrls.length} segments...` });

    const segmentFiles: string[] = [];
    for (let i = 0; i < segmentUrls.length; i++) {
        const segFilename = `seg_${i.toString().padStart(4, "0")}.ts`;
        const segData = await downloadViaProxy(segmentUrls[i], segFilename);
        await ffmpeg.writeFile(segFilename, segData);
        segmentFiles.push(segFilename);
        onProgress?.({
            phase: "downloading_video",
            percent: 5 + Math.round((i / segmentUrls.length) * 70),
            message: `Downloading segment ${i + 1}/${segmentUrls.length}...`,
        });
    }

    const concatList = segmentFiles.map((f) => `file '${f}'`).join("\n");
    await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(concatList));

    onProgress?.({ phase: "merging", percent: 0, message: "Converting to MP4..." });

    const progressHandler = ({ progress }: { progress: number }) => {
        onProgress?.({
            phase: "merging",
            percent: Math.round(Math.min(progress, 1) * 100),
            message: `Converting... ${Math.round(Math.min(progress, 1) * 100)}%`,
        });
    };
    ffmpeg.on("progress", progressHandler);

    try {
        await ffmpeg.exec([
            "-f", "concat",
            "-safe", "0",
            "-i", "concat.txt",
            "-c:v", "copy",
            "-c:a", "copy",
            "-movflags", "+faststart",
            outputFilename,
        ]);
    } finally {
        ffmpeg.off("progress", progressHandler);
    }

    const outputData = await ffmpeg.readFile(outputFilename);

    try {
        for (const f of segmentFiles) await ffmpeg.deleteFile(f);
        await ffmpeg.deleteFile("concat.txt");
        await ffmpeg.deleteFile(outputFilename);
    } catch { /* ignore */ }

    onProgress?.({ phase: "complete", percent: 100, message: "Done!" });
    return new Blob([outputData as BlobPart], { type: "video/mp4" });
}