import { PlatformLogo } from "./PlatformLogos";

interface PlatformBadgeProps {
    platform: string;
}

const PLATFORM_LABELS: Record<string, string> = {
    youtube: "YouTube",
    instagram: "Instagram",
    twitter: "Twitter / X",
    facebook: "Facebook",
};

export default function PlatformBadge({ platform }: PlatformBadgeProps) {
    const label = PLATFORM_LABELS[platform];
    if (!label) return null;

    return (
        <span className="badge" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-default)" }}>
            <PlatformLogo platform={platform} size={14} />
            <span style={{ color: "var(--text-primary)", fontSize: "11px" }}>{label}</span>
        </span>
    );
}
