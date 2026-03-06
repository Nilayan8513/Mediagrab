/**
 * Client-side FFmpeg helper using ffmpeg.wasm
 *
 * KEY DESIGN: CDN URLs (googlevideo.com, video.twimg.com) are IP-locked signed
 * URLs — they MUST be fetched directly from the browser, NOT proxied through
 * the server (server has different IP → CDN rejects → returns bytes of error).
 *
 * Only non-CDN URLs (Instagram scontent, Facebook fbcdn) go through the proxy
 * because they require specific Referer headers the browser can't set directly.
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

// ─── Direct vs Proxy decision ─────────────────────────────────────────────────
//
// YouTube googlevideo.com + Twitter video.twimg.com are IP-locked:
//   ✅ Browser fetches directly (CORS allowed, same IP as who requested the URL)
//   ❌ Server proxy fails (different IP → CDN returns error bytes)
//
// Instagram scontent + Facebook fbcdn need Referer headers:
//   ✅ Server proxy sets correct Referer
//   ❌ Browser fetch blocked by CORS / missing Referer

function shouldFetchDirectly(url: string): boolean {
    return (
        url.includes("googlevideo.com") ||
        url.includes("video.twimg.com") ||
        url.includes("ton.twimg.com") ||
        url.includes("pbs.twimg.com")
    );
}

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

        ffmpeg.on("log", ({ message }) => {
            if (process.env.NODE_ENV === "development") console.log("[ffmpeg]", message);
        });

        // jsDelivr is faster + more reliable than unpkg for large WASM files
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
        ffmpegLoadPromise = null; // allow retry
        throw new Error(
            `Failed to load FFmpeg: ${err instanceof Error ? err.message : "unknown"}`
        );
    }
}

// ─── Core fetch with progress ─────────────────────────────────────────────────

async function fetchWithProgress(
    url: string,
    label: string,
    onProgress?: (percent: number) => void
): Promise<Uint8Array> {
    const direct = shouldFetchDirectly(url);

    let fetchUrl: string;
    let fetchOptions: RequestInit;

    if (direct) {
        // Fetch directly from browser — CDN allows CORS, URL is signed for client IP
        fetchUrl = url;
        fetchOptions = { mode: "cors" };
        console.log(`[fetch] DIRECT → ${label}`);
    } else {
        // Route through server proxy for Instagram/Facebook (need Referer)
        fetchUrl = `/api/proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(label)}`;
        fetchOptions = {};
        console.log(`[fetch] PROXY → ${label}`);
    }

    const res = await fetch(fetchUrl, fetchOptions);

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
            `Failed to download ${label} (HTTP ${res.status}): ${text.slice(0, 200)}`
        );
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
            onProgress(Math.min(90, Math.round((received / 5_000_000) * 50)));
        }
    }

    onProgress?.(100);

    // Combine chunks
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

    // Download video stream (direct from CDN if YouTube/Twitter)
    onProgress?.({ phase: "downloading_video", percent: 0, message: "Downloading video stream..." });
    const videoData = await fetchWithProgress(videoUrl, "video.mp4", (pct) => {
        onProgress?.({
            phase: "downloading_video",
            percent: pct,
            message: `Downloading video... ${pct}%`,
        });
    });

    // Download audio stream
    onProgress?.({ phase: "downloading_audio", percent: 0, message: "Downloading audio stream..." });
    const audioData = await fetchWithProgress(audioUrl, "audio.m4a", (pct) => {
        onProgress?.({
            phase: "downloading_audio",
            percent: pct,
            message: `Downloading audio... ${pct}%`,
        });
    });

    // Merge in browser via FFmpeg.wasm
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
            "-c:v", "copy",         // No re-encode — just remux, very fast
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

    // Free RAM immediately
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
        const mediaData = await fetchWithProgress(mediaPlaylistUrl, "media.m3u8");
        mediaManifestText = new TextDecoder().decode(mediaData);
    }

    const mediaBaseUrl = mediaPlaylistUrl.substring(0, mediaPlaylistUrl.lastIndexOf("/") + 1);
    const segmentUrls: string[] = [];
    for (const line of mediaManifestText.split("\n").map((l) => l.trim())) {
        if (line.length > 0 && !line.startsWith("#")) {
            segmentUrls.push(line.startsWith("http") ? line : mediaBaseUrl + line);
        }
    }
    if (segmentUrls.length === 0) throw new Error("No segments found in m3u8");

    const segmentFiles: string[] = [];
    for (let i = 0; i < segmentUrls.length; i++) {
        const segFilename = `seg_${i.toString().padStart(4, "0")}.ts`;
        const segData = await fetchWithProgress(segmentUrls[i], segFilename);
        await ffmpeg.writeFile(segFilename, segData);
        segmentFiles.push(segFilename);
        onProgress?.({
            phase: "downloading_video",
            percent: 5 + Math.round((i / segmentUrls.length) * 70),
            message: `Segment ${i + 1}/${segmentUrls.length}...`,
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