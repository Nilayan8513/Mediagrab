import { NextRequest } from "next/server";
import { getProgress } from "@/lib/ytdlp";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const downloadId = request.nextUrl.searchParams.get("id");

    if (!downloadId) {
        return new Response("Missing download id", { status: 400 });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        start(controller) {
            const interval = setInterval(() => {
                const progress = getProgress(downloadId);

                if (progress) {
                    const data = `data: ${JSON.stringify(progress)}\n\n`;
                    controller.enqueue(encoder.encode(data));

                    if (progress.status === "complete" || progress.status === "error") {
                        clearInterval(interval);
                        controller.close();
                    }
                } else {
                    // Send heartbeat
                    controller.enqueue(encoder.encode(": heartbeat\n\n"));
                }
            }, 500);

            // Clean up on abort
            request.signal.addEventListener("abort", () => {
                clearInterval(interval);
                try {
                    controller.close();
                } catch { /* already closed */ }
            });
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
