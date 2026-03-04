"use client";

import { useState, useRef, type ReactNode } from "react";
import { YouTubeLogo, InstagramLogo, XLogo, FacebookLogo } from "./PlatformLogos";

interface UrlInputProps {
    onAnalyze: (url: string) => void;
    isLoading: boolean;
    detectedPlatform: string | null;
}

const PLATFORM_ICONS: Record<string, { icon: ReactNode; color: string }> = {
    youtube: { icon: <YouTubeLogo size={18} />, color: "#dc2626" },
    instagram: { icon: <InstagramLogo size={18} />, color: "#e1306c" },
    twitter: { icon: <XLogo size={18} />, color: "#000000" },
    facebook: { icon: <FacebookLogo size={18} />, color: "#1877f2" },
};

function quickDetectPlatform(url: string): string | null {
    if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
    if (/instagram\.com/i.test(url)) return "instagram";
    if (/twitter\.com|x\.com/i.test(url)) return "twitter";
    if (/facebook\.com|fb\.watch/i.test(url)) return "facebook";
    return null;
}

export default function UrlInput({ onAnalyze, isLoading, detectedPlatform }: UrlInputProps) {
    const [url, setUrl] = useState("");
    const [localPlatform, setLocalPlatform] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const platform = detectedPlatform || localPlatform;
    const platformInfo = platform ? PLATFORM_ICONS[platform] : null;

    const handleChange = (val: string) => {
        setUrl(val);
        setLocalPlatform(quickDetectPlatform(val));
    };

    const handlePaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            handleChange(text);
            inputRef.current?.focus();
        } catch {
            /* clipboard access denied */
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (url.trim()) onAnalyze(url.trim());
    };

    return (
        <form onSubmit={handleSubmit} className="w-full">
            <div className="relative">
                {/* Platform indicator */}
                {platformInfo && (
                    <div
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold z-10 animate-fade-up"
                        style={{
                            backgroundColor: `${platformInfo.color}14`,
                            color: platformInfo.color,
                        }}
                    >
                        {platformInfo.icon}
                    </div>
                )}

                <input
                    ref={inputRef}
                    id="url-input"
                    type="url"
                    value={url}
                    onChange={(e) => handleChange(e.target.value)}
                    placeholder="Paste a link here..."
                    className="input-field pr-20"
                    style={{
                        paddingLeft: platformInfo ? "50px" : "18px",
                        transition: "padding-left 0.2s",
                    }}
                    disabled={isLoading}
                    autoComplete="off"
                    spellCheck={false}
                />

                {/* Action buttons */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1.5">
                    {url && (
                        <button
                            type="button"
                            onClick={() => { setUrl(""); setLocalPlatform(null); }}
                            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors text-xs"
                            style={{ color: "var(--text-muted)" }}
                            aria-label="Clear"
                        >
                            ✕
                        </button>
                    )}
                    {!url && (
                        <button
                            type="button"
                            onClick={handlePaste}
                            className="px-3 h-7 rounded-lg flex items-center justify-center text-xs font-medium transition-colors"
                            style={{ color: "var(--accent)" }}
                        >
                            Paste
                        </button>
                    )}
                </div>
            </div>

            <button
                type="submit"
                disabled={!url.trim() || isLoading}
                className="btn-primary w-full mt-3 flex items-center justify-center gap-2"
                id="analyze-button"
            >
                {isLoading ? (
                    <>
                        <span className="spinner" />
                        Analyzing...
                    </>
                ) : (
                    <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        Analyze
                    </>
                )}
            </button>
        </form>
    );
}
