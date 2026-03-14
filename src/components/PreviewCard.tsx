"use client";

import PlatformBadge from "./PlatformBadge";

/** Route external thumbnail URLs through our proxy to avoid CORS browser blocks */
function getThumbnailSrc(url: string): string {
    if (!url) return "";
    // data: URIs (instaloader base64) and relative URLs pass through directly
    if (url.startsWith("data:") || url.startsWith("/")) return url;
    // Proxy all external http(s) URLs
    if (url.startsWith("http://") || url.startsWith("https://")) {
        return `/api/thumbnail?url=${encodeURIComponent(url)}`;
    }
    return url;
}

interface MediaItem {
    type: "video" | "photo";
    title: string;
    thumbnail: string;
    duration: number | null;
    index: number;
}

interface PreviewCardProps {
    platform: string;
    title: string;
    uploader: string;
    items: MediaItem[];
    activeIndex: number;
    onSelectItem: (index: number) => void;
}

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function PreviewCard({ platform, title, uploader, items, activeIndex, onSelectItem }: PreviewCardProps) {
    const isCarousel = items.length > 1;
    const activeItem = items[activeIndex] || items[0];

    return (
        <div className="preview-glass-card animate-fade-up" id="preview-card">
            {/* Main preview */}
            <div className="flex flex-col sm:flex-row gap-4">
                {/* Thumbnail */}
                <div
                    className="relative flex-shrink-0 w-full sm:w-44 h-36 sm:h-28 rounded-xl overflow-hidden group"
                    style={{ background: "var(--bg-input)" }}
                >
                    {activeItem?.thumbnail && !activeItem.thumbnail.includes("THUMB") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={getThumbnailSrc(activeItem.thumbnail)}
                            alt={activeItem.title}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl" style={{ color: "var(--text-muted)" }}>
                            {activeItem?.type === "photo" ? "📷" : "🎬"}
                        </div>
                    )}

                    {/* Duration */}
                    {activeItem?.duration && activeItem.type === "video" && (
                        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-[11px] font-mono text-white" style={{ background: "rgba(0,0,0,0.7)" }}>
                            {formatDuration(activeItem.duration)}
                        </div>
                    )}

                    {/* Type label */}
                    <div
                        className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase text-white tracking-wide"
                        style={{
                            background: activeItem?.type === "photo" ? "rgba(139,92,246,0.7)" : "linear-gradient(135deg,#8B5CF6,#3B82F6)",
                        }}
                    >
                        {activeItem?.type === "photo" ? "Photo" : "Video"}
                    </div>

                    {/* Carousel arrows */}
                    {isCarousel && (
                        <>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectItem(activeIndex > 0 ? activeIndex - 1 : items.length - 1);
                                }}
                                className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label="Previous"
                            >
                                ‹
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectItem(activeIndex < items.length - 1 ? activeIndex + 1 : 0);
                                }}
                                className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label="Next"
                            >
                                ›
                            </button>
                        </>
                    )}

                    {/* Counter */}
                    {isCarousel && (
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 px-2 py-0.5 rounded-full text-[10px] font-medium text-white">
                            {activeIndex + 1} / {items.length}
                        </div>
                    )}
                </div>

                {/* Text info */}
                <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <PlatformBadge platform={platform} />
                        {isCarousel && (() => {
                            const photoCount = items.filter(i => i.type === "photo").length;
                            const videoCount = items.filter(i => i.type === "video").length;
                            const parts: string[] = [];
                            if (photoCount > 0) parts.push(`${photoCount} Photo${photoCount > 1 ? "s" : ""}`);
                            if (videoCount > 0) parts.push(`${videoCount} Video${videoCount > 1 ? "s" : ""}`);
                            return (
                                <span
                                    className="badge"
                                    style={{
                                        background: "rgba(34, 197, 94, 0.1)",
                                        color: "#22c55e",
                                    }}
                                >
                                    📂 {parts.join(", ")}
                                </span>
                            );
                        })()}
                    </div>
                    <h3 className="text-sm font-semibold leading-snug line-clamp-2" style={{ color: "var(--text-primary)" }}>
                        {title}
                    </h3>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        {uploader}
                    </p>
                </div>
            </div>

            {/* Carousel strip */}
            {isCarousel && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {items.map((item, idx) => (
                        <button
                            key={idx}
                            onClick={() => onSelectItem(idx)}
                            className="relative flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden transition-all duration-200"
                            style={{
                                border: idx === activeIndex
                                    ? "2px solid var(--accent)"
                                    : "2px solid var(--border-default)",
                                opacity: idx === activeIndex ? 1 : 0.6,
                                transform: idx === activeIndex ? "scale(1.05)" : "scale(1)",
                            }}
                        >
                            {item.thumbnail && !item.thumbnail.includes("THUMB") ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={getThumbnailSrc(item.thumbnail)}
                                    alt={`Item ${idx + 1}`}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-xs" style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}>
                                    {item.type === "photo" ? "📷" : "🎬"}
                                </div>
                            )}
                            <div
                                className="absolute bottom-0 right-0 px-1 py-px rounded-tl text-[8px] font-bold uppercase text-white leading-none"
                                style={{
                                    background: item.type === "photo" ? "rgba(139,92,246,0.7)" : "linear-gradient(135deg,#8B5CF6,#3B82F6)",
                                    fontSize: "7px",
                                    letterSpacing: "0.03em",
                                }}
                            >
                                {item.type === "photo" ? "📷" : "🎬"}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
