import { NextRequest, NextResponse } from "next/server";
import { downloadVideo, downloadAudio, downloadPhoto, downloadWithGalleryDl, clearProgress } from "@/lib/ytdlp";
import { downloadWithInstaloader } from "@/lib/instaloader";
import { randomUUID } from "crypto";
import { createReadStream, unlinkSync, statSync, existsSync, readdirSync, rmSync } from "fs";
import { join, basename } from "path";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const {
            url,
            formatId,
            downloadId: clientDownloadId,
            itemType,        // "video" | "photo"
            directUrl,       // For photos: the direct image URL
            itemIndex,       // For gallery-dl/instaloader: specific item index
            useGalleryDl,    // Whether to use gallery-dl for download
            useInstaloader,  // Whether to use instaloader for download
            audioOnly,       // Whether to download audio only
        } = body;

        if (!url || typeof url !== "string") {
            return NextResponse.json({ error: "URL is required" }, { status: 400 });
        }

        const downloadId = clientDownloadId || randomUUID();

        let filePath: string;
        let filename: string;
        let isDirectory = false;

        if (audioOnly) {
            // Audio-only download via yt-dlp
            const result = await downloadAudio(url, downloadId);
            filePath = result.filePath;
            filename = result.filename;
        } else if (useInstaloader) {
            // Use instaloader for Instagram photos/carousels
            const result = await downloadWithInstaloader(url, downloadId, itemIndex);
            filePath = result.filePath;
            filename = result.filename;
            isDirectory = result.isZip || false;
        } else if (itemType === "photo" && directUrl) {
            // Download photo directly via HTTP
            const result = await downloadPhoto(directUrl, downloadId);
            filePath = result.filePath;
            filename = result.filename;
        } else if (useGalleryDl) {
            // Use gallery-dl for download
            const result = await downloadWithGalleryDl(url, downloadId, itemIndex);
            filePath = result.filePath;
            filename = result.filename;
            isDirectory = result.isZip || false;
        } else {
            // Use yt-dlp for video download
            const result = await downloadVideo(url, formatId || "", downloadId);
            filePath = result.filePath;
            filename = result.filename;
        }

        if (isDirectory) {
            // Multiple files: find all and create a zip-like response
            // For simplicity, send the first file found or archive the directory
            const files = findFilesRecursive(filePath);

            if (files.length === 0) {
                return NextResponse.json({ error: "No files downloaded" }, { status: 500 });
            }

            if (files.length === 1) {
                // Single file in directory
                return streamFile(files[0], basename(files[0]), downloadId, filePath);
            }

            // Multiple files: return file list so frontend can download individually
            const fileList = files.map((f, i) => ({
                index: i,
                filename: basename(f),
                path: f,
                size: statSync(f).size,
            }));

            return NextResponse.json({
                type: "multi",
                downloadId,
                files: fileList,
            });
        }

        // Single file: stream it
        return streamFile(filePath, filename, downloadId);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Download failed";
        console.error("Download error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

function streamFile(filePath: string, filename: string, downloadId: string, cleanupDir?: string) {
    const stat = statSync(filePath);
    const stream = createReadStream(filePath);

    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
        mp4: "video/mp4",
        webm: "video/webm",
        mkv: "video/x-matroska",
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        gif: "image/gif",
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
