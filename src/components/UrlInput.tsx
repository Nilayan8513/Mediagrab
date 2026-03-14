"use client";
import { useState, useRef, type ReactElement } from "react";
import { InstagramLogo, XLogo, FacebookLogo } from "./PlatformLogos";

interface UrlInputProps {
  onAnalyze: (url: string) => void;
  isLoading: boolean;
  detectedPlatform: string | null;
}

const PLATFORM_ICONS: Record<string, ReactElement> = {
  instagram: <InstagramLogo size={18} />,
  twitter:   <XLogo size={18} />,
  facebook:  <FacebookLogo size={18} />,
};

function quickDetectPlatform(url: string): string | null {
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
  const platformIcon = platform ? PLATFORM_ICONS[platform] : null;

  const handleChange = (val: string) => {
    setUrl(val);
    setLocalPlatform(quickDetectPlatform(val));
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      handleChange(text);
      inputRef.current?.focus();
    } catch { /* clipboard denied */ }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) onAnalyze(url.trim());
  };

  return (
    <form onSubmit={handleSubmit} style={{ width: "100%" }}>
      <div className="url-input-wrapper">
        {platformIcon ? (
          <div className="url-platform-icon animate-fade-up">{platformIcon}</div>
        ) : (
          <span style={{ fontSize: "16px", marginRight: "4px", flexShrink: 0 }}>✦</span>
        )}

        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Paste any social media URL here..."
          className="url-input-field"
          disabled={isLoading}
          autoComplete="off"
          spellCheck={false}
        />

        <div className="url-input-actions">
          {url && !isLoading && (
            <button
              type="button"
              className="url-icon-btn"
              onClick={() => { setUrl(""); setLocalPlatform(null); }}
              aria-label="Clear URL"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}

          {!url && !isLoading && (
            <button
              type="button"
              className="url-icon-btn"
              onClick={handlePaste}
              aria-label="Paste from clipboard"
              title="Paste"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="4" rx="1"/>
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
              </svg>
            </button>
          )}

          <button
            type="submit"
            className="url-preview-btn"
            disabled={!url.trim() || isLoading}
            aria-label="Analyze URL"
          >
            {isLoading ? (
              <>
                <span className="spinner" />
                Analyzing...
              </>
            ) : (
              <>
                Preview
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
