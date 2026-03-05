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
}

function formatSize(bytes: number | null): string {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function QualitySelector({ formats, selectedFormat, onSelect, disabled }: QualitySelectorProps) {
    if (!formats || formats.length === 0) return null;

    return (
        <div className="animate-fade-up" id="quality-selector">
            <label className="block text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                Quality
            </label>
            <select
                className="select-field w-full"
                value={selectedFormat}
                onChange={(e) => onSelect(e.target.value)}
                disabled={disabled}
            >
                {formats.map((f) => (
                    <option key={f.format_id} value={f.format_id}>
                        {f.has_audio ? "🔊 " : "📹 "}{f.quality} • {f.ext.toUpperCase()}
                        {f.filesize ? ` • ~${formatSize(f.filesize)}` : ""}
                        {f.has_audio === false ? " (video only)" : ""}
                    </option>
                ))}
            </select>
        </div>
    );
}

