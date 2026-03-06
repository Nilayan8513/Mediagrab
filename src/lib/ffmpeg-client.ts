/**
 * Client-side FFmpeg helper using ffmpeg.wasm
 *
 * FETCH STRATEGY:
 * All platform CDN URLs go through /api/proxy which:
 *   - Adds correct Referer / User-Agent headers
 *   - Streams bytes directly to the browser (no server-side storage)
 *   - Adds CORS headers so browser fetch() works
 *
 * The proxy is just a pass-through — all processing (FFmpeg merge, file save)
 * happens in the browser using client system resources.
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

// ─── Fetch strategy ───────────────────────────────────────────────────────────

/** All CDN URLs go through /api/proxy for reliable CORS + correct headers */
function shouldFetchDirectly(_url: string): boolean {
    // Always proxy — CDN URLs don't reliably serve CORS headers for fetch().
    // The proxy streams bytes directly (no server storage / processing).
    return false;
}

// ─── Load FFmpeg (singleton) ──────────────────────────────────────────────────

async function loadFFmpeg(onProgress?: (p: FFmpegProgress) => void): Promise<FFmpeg> {
    if (ffmpegInstance) return ffmpegInstance;

    if (ffmpegLoadPromise) {
        onProgress?.({ phase: "loading", percent: 0, message: "Loading FFmpeg..." });
        return ffmpegLoadPromise;
    }

    ffmpegLoadPromise = (async () => {
        onProgress?.({ phase: "loading", percent: 0, message: "Loading FFmpeg..." });
        const ffmpeg = new FFmpeg();
        ffmpeg.on("log", ({ message }) => {
            if (process.env.NODE_ENV === "development") console.log("[ffmpeg]", message);
        });
        const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";
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
        ffmpegLoadPromise = null;
        throw new Error(`Failed to load FFmpeg: ${err instanceof Error ? err.message : "unknown"}`);
    }
}

// ─── Fetch with progress ──────────────────────────────────────────────────────

export async function fetchWithProgress(
    url: string,
    label: string,
    onProgress?: (percent: number) => void
): Promise<Uint8Array> {

    const direct = shouldFetchDirectly(url);
    const fetchUrl = direct
        ? url
        : `/api/proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(label)}`;

    console.log(`[fetch] ${direct ? "DIRECT" : "PROXY"} → ${label} (${new URL(url).hostname})`);

    const res = await fetch(fetchUrl, direct ? { mode: "cors" } : {});

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to download ${label} (HTTP ${res.status}): ${text.slice(0, 300)}`);
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
        if (total > 0 && onProgress) {
            onProgress(Math.min(99, Math.round((received / total) * 100)));
        } else if (onProgress) {
            onProgress(Math.min(90, Math.round((received / 5_000_000) * 60)));
        }
    }

    onProgress?.(100);

    const result = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

// ─── Merge video + audio → MP4 ───────────────────────────────────────────────

export async function mergeVideoAudio(
    videoUrl: string,
    audioUrl: string,
    outputFilename: string,
    onProgress?: (p: FFmpegProgress) => void
): Promise<Blob> {
    const ffmpeg = await loadFFmpeg(onProgress);

    onProgress?.({ phase: "downloading_video", percent: 0, message: "Downloading video..." });
    const videoData = await fetchWithProgress(videoUrl, "video.mp4", (pct) => {
        onProgress?.({ phase: "downloading_video", percent: pct, message: `Downloading video... ${pct}%` });
    });

    onProgress?.({ phase: "downloading_audio", percent: 0, message: "Downloading audio..." });
    const audioData = await fetchWithProgress(audioUrl, "audio.m4a", (pct) => {
        onProgress?.({ phase: "downloading_audio", percent: pct, message: `Downloading audio... ${pct}%` });
    });

    onProgress?.({ phase: "merging", percent: 0, message: "Merging streams..." });
    await ffmpeg.writeFile("v_in.mp4", videoData);
    await ffmpeg.writeFile("a_in.m4a", audioData);

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
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
            "-shortest",
            outputFilename,
        ]);
    } finally {
        ffmpeg.off("progress", progressHandler);
    }

    const outputData = await ffmpeg.readFile(outputFilename);
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
    const audioData = await fetchWithProgress(audioUrl, "audio_src", (pct) => {
        onProgress?.({ phase: "downloading_audio", percent: pct, message: `Downloading audio... ${pct}%` });
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
            "-q:a", "0",
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

// ─── Simple download (combined formats / photos) ─────────────────────────────

export async function proxyDownload(
    cdnUrl: string,
    filename: string,
    onProgress?: (percent: number) => void
): Promise<Blob> {
    const data = await fetchWithProgress(cdnUrl, filename, onProgress);
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
        mp4: "video/mp4", webm: "video/webm",
        jpg: "image/jpeg", jpeg: "image/jpeg",
        png: "image/png", webp: "image/webp",
        mp3: "audio/mpeg", m4a: "audio/mp4",
    };
    return new Blob([data as BlobPart], { type: mimeMap[ext] ?? "application/octet-stream" });
}

// ─── M3U8 / HLS ──────────────────────────────────────────────────────────────

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

    const manifestData = await fetchWithProgress(m3u8Url, "manifest.m3u8");
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
                    if (!lines[j].startsWith("#")) { variantUrls.push(lines[j]); break; }
                }
            }
        }
        if (!variantUrls.length) throw new Error("No streams found in m3u8");
        const best = variantUrls[variantUrls.length - 1];
        mediaPlaylistUrl = best.startsWith("http") ? best : baseUrl + best;
        mediaManifestText = new TextDecoder().decode(await fetchWithProgress(mediaPlaylistUrl, "media.m3u8"));
    }

    const mediaBaseUrl = mediaPlaylistUrl.substring(0, mediaPlaylistUrl.lastIndexOf("/") + 1);
    const segmentUrls: string[] = [];
    for (const line of mediaManifestText.split("\n").map((l) => l.trim())) {
        if (line.length > 0 && !line.startsWith("#")) {
            segmentUrls.push(line.startsWith("http") ? line : mediaBaseUrl + line);
        }
    }
    if (!segmentUrls.length) throw new Error("No segments found in m3u8");

    const segmentFiles: string[] = [];
    for (let i = 0; i < segmentUrls.length; i++) {
        const segFilename = `seg_${i.toString().padStart(4, "0")}.ts`;
        await ffmpeg.writeFile(segFilename, await fetchWithProgress(segmentUrls[i], segFilename));
        segmentFiles.push(segFilename);
        onProgress?.({
            phase: "downloading_video",
            percent: 5 + Math.round((i / segmentUrls.length) * 70),
            message: `Segment ${i + 1}/${segmentUrls.length}...`,
        });
    }

    await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(segmentFiles.map((f) => `file '${f}'`).join("\n")));

    onProgress?.({ phase: "merging", percent: 0, message: "Converting to MP4..." });
    const progressHandler = ({ progress }: { progress: number }) => {
        onProgress?.({ phase: "merging", percent: Math.round(Math.min(progress, 1) * 100), message: `Converting... ${Math.round(Math.min(progress, 1) * 100)}%` });
    };
    ffmpeg.on("progress", progressHandler);

    try {
        await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c:v", "copy", "-c:a", "copy", "-movflags", "+faststart", outputFilename]);
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