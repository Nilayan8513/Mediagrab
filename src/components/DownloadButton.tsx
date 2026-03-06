"use client";

type Status = "idle" | "downloading" | "merging" | "complete" | "error";

interface DownloadButtonProps {
    onClick: () => void;
    onAudio?: () => void;
    onDownloadAll?: () => void;
    progress: number | null;
    status: Status;
    audioProgress?: number | null;
    audioStatus?: Status;
    speed?: string;
    eta?: string;
    disabled?: boolean;
    itemType?: "video" | "photo";
    isCarousel?: boolean;
    isVideo?: boolean;
    photoCount?: number;
    videoCount?: number;
}

function ActionButton({
    onClick,
    disabled,
    isActive,
    progress,
    status,
    label,
    icon,
}: {
    onClick: () => void;
    disabled: boolean;
    isActive: boolean;
    progress: number | null;
    status: Status;
    label: string;
    icon: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled || isActive}
            className="btn-primary w-full flex items-center justify-center gap-2 relative overflow-hidden"
        >
            {isActive && progress !== null && (
                <div
                    className="absolute inset-0 transition-all duration-300"
                    style={{ width: `${progress}%`, background: "rgba(255,255,255,0.15)" }}
                />
            )}
            <span className="relative z-10 flex items-center gap-2">
                {status === "idle" && (
                    <>
                        {icon}
                        {label}
                    </>
                )}
                {status === "downloading" && (
                    <>
                        <span className="spinner" />
                        Downloading {progress !== null ? `${progress.toFixed(0)}%` : "..."}
                    </>
                )}
                {status === "merging" && (
                    <>
                        <span className="spinner" />
                        Processing...
                    </>
                )}
                {status === "complete" && (
                    <>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Done!
                    </>
                )}
                {status === "error" && (
                    <>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        Failed — Retry
                    </>
                )}
            </span>
        </button>
    );
}

const DownloadIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);

const AudioIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
);

function ProgressBar({ progress, speed, eta, status }: { progress: number; speed?: string; eta?: string; status: Status }) {
    return (
        <div className="space-y-1.5">
            <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.max(progress, 2)}%` }} />
            </div>
            <div className="flex justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                <span>{status === "merging" ? "Processing..." : (speed || "Calculating...")}</span>
                <span>{eta ? `ETA: ${eta}` : ""}</span>
            </div>
        </div>
    );
}

export default function DownloadButton({
    onClick,
    onAudio,
    onDownloadAll,
    progress,
    status,
    audioProgress = null,
    audioStatus = "idle",
    speed,
    eta,
    disabled,
    itemType = "video",
    isCarousel = false,
    isVideo = false,
    photoCount = 0,
    videoCount = 0,
}: DownloadButtonProps) {
    const isVideoActive = status === "downloading" || status === "merging";
    const isAudioActive = audioStatus === "downloading" || audioStatus === "merging";
    const anyActive = isVideoActive || isAudioActive;

    return (
        <div className="animate-fade-up w-full space-y-2.5" id="download-section">
            {/* Video download button */}
            <ActionButton
                onClick={onClick}
                disabled={!!disabled || anyActive}
                isActive={isVideoActive}
                progress={progress}
                status={status}
                label={itemType === "photo" ? "Download Photo" : isCarousel ? "Download This Item" : "Download Video"}
                icon={DownloadIcon}
            />

            {/* Video progress bar */}
            {isVideoActive && progress !== null && (
                <ProgressBar progress={progress} speed={speed} eta={eta} status={status} />
            )}

            {/* Audio download button — same style as video */}
            {isVideo && onAudio && (
                <ActionButton
                    onClick={onAudio}
                    disabled={!!disabled || anyActive}
                    isActive={isAudioActive}
                    progress={audioProgress}
                    status={audioStatus}
                    label="Download Audio (MP3)"
                    icon={AudioIcon}
                />
            )}

            {/* Audio progress bar */}
            {isAudioActive && audioProgress !== null && (
                <ProgressBar progress={audioProgress} speed={speed} eta={eta} status={audioStatus} />
            )}

            {/* Download All for carousels */}
            {isCarousel && onDownloadAll && !anyActive && (() => {
                const parts: string[] = [];
                if (photoCount > 0) parts.push(`${photoCount} Photo${photoCount > 1 ? "s" : ""}`);
                if (videoCount > 0) parts.push(`${videoCount} Video${videoCount > 1 ? "s" : ""}`);
                const summary = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
                return (
                    <button
                        onClick={onDownloadAll}
                        disabled={!!disabled || anyActive}
                        className="btn-primary w-full flex items-center justify-center gap-2"
                        style={{ background: "rgba(34, 197, 94, 0.85)" }}
                    >
                        {DownloadIcon}
                        Download All{summary} (ZIP)
                    </button>
                );
            })()}
        </div>
    );
}
