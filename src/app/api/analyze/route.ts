import { NextRequest, NextResponse } from "next/server";
import { analyzeUrl, detectPlatform } from "@/lib/ytdlp";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { url } = body;

        if (!url || typeof url !== "string") {
            return NextResponse.json(
                { error: "URL is required" },
                { status: 400 }
            );
        }

        const platform = detectPlatform(url);

        if (platform === "unknown") {
            return NextResponse.json(
                { error: "Unsupported platform. We support Instagram, Twitter/X, and Facebook." },
                { status: 400 }
            );
        }

        const mediaInfo = await analyzeUrl(url);

        if (mediaInfo.items.length === 0) {
            return NextResponse.json(
                { error: "No downloadable media found in this post." },
                { status: 404 }
            );
        }

        return NextResponse.json(mediaInfo);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Analysis failed";
        console.error("Analyze error:", message);
        return NextResponse.json(
            { error: message },
            { status: 500 }
        );
    }
}