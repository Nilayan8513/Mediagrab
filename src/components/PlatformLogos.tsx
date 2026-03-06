/* Platform logo SVG components — real brand marks */

interface LogoProps {
    size?: number;
    className?: string;
}

export function YouTubeLogo({ size = 18, className }: LogoProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} style={{ filter: "drop-shadow(0 1px 2px rgba(255,0,0,0.3))" }}>
            <path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
    );
}

export function InstagramLogo({ size = 18, className }: LogoProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} style={{ filter: "drop-shadow(0 1px 2px rgba(225,48,108,0.3))" }}>
            <defs>
                <radialGradient id="ig-grad" cx="30%" cy="107%" r="150%">
                    <stop offset="0%" stopColor="#fdf497" />
                    <stop offset="5%" stopColor="#fdf497" />
                    <stop offset="45%" stopColor="#fd5949" />
                    <stop offset="60%" stopColor="#d6249f" />
                    <stop offset="90%" stopColor="#285AEB" />
                </radialGradient>
            </defs>
            <rect width="24" height="24" rx="6" fill="url(#ig-grad)" />
            <circle cx="12" cy="12" r="4.5" fill="none" stroke="white" strokeWidth="1.8" />
            <circle cx="17.5" cy="6.5" r="1.2" fill="white" />
            <rect x="2" y="2" width="20" height="20" rx="5" fill="none" stroke="white" strokeWidth="1.8" />
        </svg>
    );
}

export function XLogo({ size = 18, className }: LogoProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.15))" }}>
            <rect width="24" height="24" rx="5" fill="#000000" />
            <path d="M13.808 10.469L18.95 4.5h-1.218l-4.465 5.183L9.76 4.5H5.5l5.394 7.842L5.5 18.9h1.218l4.716-5.48L15.24 18.9H19.5l-5.692-8.431zm-1.67 1.94l-.547-.782L7.257 5.43h1.872l3.512 5.024.547.782 4.564 6.526h-1.872l-3.742-5.353z" fill="white" />
        </svg>
    );
}

export function FacebookLogo({ size = 18, className }: LogoProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} style={{ filter: "drop-shadow(0 1px 2px rgba(24,119,242,0.3))" }}>
            <circle cx="12" cy="12" r="12" fill="#1877F2" />
            <path d="M16.671 15.469l.547-3.585H13.78V9.647c0-.98.48-1.937 2.021-1.937h1.564V4.77s-1.42-.242-2.777-.242c-2.834 0-4.685 1.717-4.685 4.828v2.733H6.934v3.585h2.969V23.85a11.817 11.817 0 003.656 0V15.469h3.112z" fill="white" />
        </svg>
    );
}

export function PlatformLogo({ platform, size = 18 }: { platform: string; size?: number }) {
    switch (platform) {
        case "instagram": return <InstagramLogo size={size} />;
        case "twitter": return <XLogo size={size} />;
        case "facebook": return <FacebookLogo size={size} />;
        default: return null;
    }
}
