import { PlatformLogo } from "./PlatformLogos";

interface PlatformBadgeProps {
    platform: string;
}

const LABELS: Record<string, string> = {
    instagram: "Instagram",
    twitter: "Twitter / X",
    facebook: "Facebook",
    youtube: "YouTube",
};

export default function PlatformBadge({ platform }: PlatformBadgeProps) {
    const label = LABELS[platform];
    if (!label) return null;
    return (
        <span className="platform-badge">
            <PlatformLogo platform={platform} size={13} />
            {label}
        </span>
    );
}
