import { NextRequest } from "next/server";
import { createReadStream, statSync, unlinkSync } from "fs";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { path: filePath } = body;

        if (!filePath || typeof filePath !== "string") {
            return new Response("File path is required", { status: 400 });
        }

        // Security: only serve files from temp directory
        const tmpDir = (process.env.TEMP || process.env.TMP || "/tmp").replace(/\\/g, "/");
        const normalizedPath = filePath.replace(/\\/g, "/");
        if (!normalizedPath.startsWith(tmpDir) || !normalizedPath.includes("mediagrab_")) {
            return new Response("Access denied", { status: 403 });
        }

        const stat = statSync(filePath);
        const stream = createReadStream(filePath);

        const filename = filePath.split(/[/\\]/).pop() || "download";
        const ext = filename.split(".").pop()?.toLowerCase();
        const mimeMap: Record<string, string> = {
            mp4: "video/mp4",
            webm: "video/webm",
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
    } catch (error) {
        const message = error instanceof Error ? error.message : "File serve failed";
        return new Response(message, { status: 500 });
    }
}
