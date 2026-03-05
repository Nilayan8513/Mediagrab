import { NextRequest } from "next/server";
import { createReadStream, statSync, unlinkSync, existsSync } from "fs";

// GET handler: browser-native download via URL query param
export async function GET(request: NextRequest) {
    const filePath = request.nextUrl.searchParams.get("path");
    if (!filePath) {
        return new Response("File path is required", { status: 400 });
    }
    return serveFile(filePath);
}

// POST handler: kept for multi-file downloads
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { path: filePath } = body;
        if (!filePath || typeof filePath !== "string") {
            return new Response("File path is required", { status: 400 });
        }
        return serveFile(filePath);
    } catch (error) {
        const message = error instanceof Error ? error.message : "File serve failed";
        return new Response(message, { status: 500 });
    }
}

function serveFile(filePath: string) {
    // Security: only serve files from temp directory
    const tmpDir = (process.env.TEMP || process.env.TMP || "/tmp").replace(/\\/g, "/");
    const normalizedPath = filePath.replace(/\\/g, "/");
    if (!normalizedPath.startsWith(tmpDir) || !normalizedPath.includes("mediagrab_")) {
        return new Response("Access denied", { status: 403 });
    }

    if (!existsSync(filePath)) {
        return new Response("File not found", { status: 404 });
    }

    const stat = statSync(filePath);
    const stream = createReadStream(filePath);

    const filename = filePath.split(/[/\\]/).pop() || "download";
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
