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

function ActionButton({
    onClick,
    disabled,
    isActive,
    progress,
    status,
    label,
    icon,
    variant = "primary",
}: {
    onClick: () => void;
    disabled: boolean;
    isActive: boolean;
    progress: number | null;
    status: Status;
    label: string;
    icon: React.ReactNode;
    variant?: "primary" | "audio" | "zip";
}) {
    const cls = variant === "primary" ? "dl-btn-primary"
              : variant === "audio"   ? "dl-btn-audio"
              :                         "dl-btn-zip";

    return (
        <button onClick={onClick} disabled={disabled || isActive} className={cls}>
            {variant === "primary" && isActive && progress !== null && (
                <div
                    className="dl-btn-progress-overlay"
                    style={{ width: `${progress}%` }}
                />
            )}
            <span style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
                {status === "idle" && <>{icon}{label}</>}
                {status === "downloading" && <><span className="spinner" />Downloading {progress !== null ? `${Math.round(progress)}%` : "…"}</>}
                {status === "merging" && <><span className="spinner" />Processing…</>}
                {status === "complete" && <>✓ Done!</>}
                {status === "error" && <>✕ Failed — Retry</>}
            </span>
        </button>
    );
}

function ProgressBar({ progress, speed, eta, status }: { progress: number; speed?: string; eta?: string; status: Status }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.max(progress, 2)}%` }} />
            </div>
            <div className="progress-meta">
                <span>{status === "merging" ? "Processing…" : (speed || "Calculating…")}</span>
                <span>{eta ? `ETA ${eta}` : ""}</span>
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
        <div className="animate-fade-up" style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px" }} id="download-section">
            {/* Primary download button */}
            <ActionButton
                onClick={onClick}
                disabled={!!disabled || anyActive}
                isActive={isVideoActive}
                progress={progress}
                status={status}
                label={itemType === "photo" ? "Download Photo" : isCarousel ? "Download This Item" : "Download Video"}
                icon={DownloadIcon}
                variant="primary"
            />

            {/* Video progress bar */}
            {isVideoActive && progress !== null && (
                <ProgressBar progress={progress} speed={speed} eta={eta} status={status} />
            )}

            {/* Audio download button */}
            {isVideo && onAudio && (
                <ActionButton
                    onClick={onAudio}
                    disabled={!!disabled || anyActive}
                    isActive={isAudioActive}
                    progress={audioProgress}
                    status={audioStatus}
                    label="Download Audio (MP3)"
                    icon={AudioIcon}
                    variant="audio"
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
                    <ActionButton
                        onClick={onDownloadAll}
                        disabled={!!disabled || anyActive}
                        isActive={false}
                        progress={null}
                        status="idle"
                        label={`Download All${summary} (ZIP)`}
                        icon={DownloadIcon}
                        variant="zip"
                    />
                );
            })()}
        </div>
    );
}
