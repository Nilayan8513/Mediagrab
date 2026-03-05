import { NextRequest, NextResponse } from "next/server";
import { downloadVideo, downloadAudio, downloadPhoto, downloadWithGalleryDl, clearProgress, setProgress } from "@/lib/ytdlp";
import { downloadWithInstaloader } from "@/lib/instaloader";
import { randomUUID } from "crypto";
import { createReadStream, unlinkSync, statSync, existsSync, readdirSync, rmSync } from "fs";
import { join, basename } from "path";
import archiver from "archiver";
import { createWriteStream } from "fs";

/**
 * Server-side download — used for:
 *   1. Audio extraction (needs ffmpeg)
 *   2. Video-only formats that need audio merging (YouTube 1080p+ etc.)
 *   3. Instagram downloads (instaloader)
 *   4. Gallery-dl downloads
 * 
 * Client-side download handles: combined video+audio formats, direct photo URLs
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const {
            url,
            formatId,
            downloadId: clientDownloadId,
            itemType,
            directUrl,
            itemIndex,
            useGalleryDl,
            useInstaloader,
            audioOnly,
        } = body;

        if (!url || typeof url !== "string") {
            return NextResponse.json({ error: "URL is required" }, { status: 400 });
        }

        const downloadId = clientDownloadId || randomUUID();

        let filePath: string;
        let filename: string;
        let isDirectory = false;

        if (audioOnly) {
            const result = await downloadAudio(url, downloadId);
            filePath = result.filePath;
            filename = result.filename;
        } else if (useInstaloader) {
            const result = await downloadWithInstaloader(url, downloadId, itemIndex);
            filePath = result.filePath;
            filename = result.filename;
            isDirectory = result.isZip || false;
        } else if (itemType === "photo" && directUrl) {
            const result = await downloadPhoto(directUrl, downloadId);
            filePath = result.filePath;
            filename = result.filename;
        } else if (useGalleryDl) {
            const result = await downloadWithGalleryDl(url, downloadId, itemIndex);
            filePath = result.filePath;
            filename = result.filename;
            isDirectory = result.isZip || false;
        } else {
            // Video download with merge (for video-only formats needing audio)
            const result = await downloadVideo(url, formatId || "", downloadId);
            filePath = result.filePath;
            filename = result.filename;
        }

        if (isDirectory) {
            const files = findFilesRecursive(filePath);

            if (files.length === 0) {
                return NextResponse.json({ error: "No files downloaded" }, { status: 500 });
            }

            if (files.length === 1) {
                return streamFile(files[0], basename(files[0]), downloadId, filePath);
            }

            setProgress(downloadId, { percent: 95, speed: "", eta: "", status: "merging" });
            const zipPath = await createZip(files, downloadId);
            const zipFilename = `mediagrab_${downloadId}.zip`;
            try { rmSync(filePath, { recursive: true, force: true }); } catch { /* ignore */ }
            return streamFile(zipPath, zipFilename, downloadId);
        }

        return streamFile(filePath, filename, downloadId);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Download failed";
        console.error("Download error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

function createZip(files: string[], downloadId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
        const zipPath = join(tmpDir, `mediagrab_${downloadId}.zip`);
        const output = createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 5 } });

        output.on("close", () => resolve(zipPath));
        archive.on("error", (err) => reject(err));

        archive.pipe(output);
        for (const file of files) {
            archive.file(file, { name: basename(file) });
        }
        archive.finalize();
    });
}

function streamFile(filePath: string, filename: string, downloadId: string, cleanupDir?: string) {
    const stat = statSync(filePath);
    const stream = createReadStream(filePath);

    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
        mp4: "video/mp4", webm: "video/webm", mkv: "video/x-matroska",
        mp3: "audio/mpeg", m4a: "audio/mp4",
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
        webp: "image/webp", gif: "image/gif", zip: "application/zip",
    };
    const contentType = mimeMap[ext || ""] || "application/octet-stream";

    const readable = new ReadableStream({
        start(controller) {
            stream.on("data", (chunk) => { controller.enqueue(chunk); });
            stream.on("end", () => {
                controller.close();
                try { unlinkSync(filePath); } catch { /* ignore */ }
                if (cleanupDir) {
                    try { rmSync(cleanupDir, { recursive: true, force: true }); } catch { /* ignore */ }
                }
                clearProgress(downloadId);
            });
            stream.on("error", (err) => { controller.error(err); });
        },
    });

    return new Response(readable, {
        headers: {
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
            "Content-Length": String(stat.size),
        },
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
