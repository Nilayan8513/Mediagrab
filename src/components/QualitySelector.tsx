interface Format {
    format_id: string;
    quality: string;
    ext: string;
    filesize: number | null;
    has_audio?: boolean;
}

interface QualitySelectorProps {
    formats: Format[];
    selectedFormat: string;
    onSelect: (formatId: string) => void;
    disabled?: boolean;
    platform?: string;
}

function formatSize(bytes: number | null): string {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function QualitySelector({ formats, selectedFormat, onSelect, disabled, platform }: QualitySelectorProps) {
    if (!formats || formats.length === 0) return null;

    const isYouTube = platform === "youtube";
    const usePills = formats.length <= 6 || isYouTube;

    return (
        <div className="animate-fade-up" id="quality-selector">
            <p className="quality-label">Quality</p>
            {usePills ? (
                <div className="quality-pills">
                    {formats.map((f) => (
                        <button
                            key={f.format_id}
                            type="button"
                            className={`quality-pill${selectedFormat === f.format_id ? " active" : ""}`}
                            onClick={() => onSelect(f.format_id)}
                            disabled={disabled}
                            title={f.filesize ? `~${formatSize(f.filesize)}` : undefined}
                        >
                            {isYouTube ? (
                                f.quality
                            ) : (
                                <>{f.has_audio ? "🔊 " : "📹 "}{f.quality}</>
                            )}
                        </button>
                    ))}
                </div>
            ) : (
                <select
                    className="quality-select"
                    value={selectedFormat}
                    onChange={(e) => onSelect(e.target.value)}
                    disabled={disabled}
                >
                    {formats.map((f) => (
                        <option key={f.format_id} value={f.format_id}>
                            {f.has_audio ? "🔊 " : "📹 "}{f.quality} · {f.ext.toUpperCase()}
                            {f.filesize ? ` · ~${formatSize(f.filesize)}` : ""}
                        </option>
                    ))}
                </select>
            )}
        </div>
    );
}
