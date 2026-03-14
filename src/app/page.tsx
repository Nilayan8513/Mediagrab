"use client";

import { useState, useCallback, useEffect } from "react";
import JSZip from "jszip";
import UrlInput from "@/components/UrlInput";
import PreviewCard from "@/components/PreviewCard";
import QualitySelector from "@/components/QualitySelector";
import DownloadButton from "@/components/DownloadButton";
import { PlatformLogo } from "@/components/PlatformLogos";
import {
  extractAudio,
  fetchWithProgress,
  isM3u8Url,
  downloadM3u8Video,
  type FFmpegProgress,
} from "@/lib/ffmpeg-client";

interface MediaFormat {
  format_id: string;
  quality: string;
  ext: string;
  filesize: number | null;
  url: string | null;
  has_audio: boolean;
}

interface MediaItem {
  type: "video" | "photo";
  title: string;
  thumbnail: string;
  duration: number | null;
  formats: MediaFormat[];
  direct_url: string | null;
  audio_url: string | null;
  index: number;
}

interface MediaInfo {
  platform: string;
  title: string;
  uploader: string;
  items: MediaItem[];
  original_url: string;
}

type DownloadStatus = "idle" | "downloading" | "merging" | "complete" | "error";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getImageExtFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 12) return "jpg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "gif";
  return "jpg";
}

async function getImageExtFromBlob(blob: Blob): Promise<string> {
  const mime = blob.type.toLowerCase();
  if (mime.includes("webp")) return "webp";
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("avif")) return "avif";
  if (mime.includes("heic")) return "heic";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  return getImageExtFromBytes(header);
}

function getImageExtFromDataUrl(dataUrl: string): string {
  const m = dataUrl.match(/^data:image\/(\w+);/);
  if (m) return m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  return "jpg";
}

const isMobile = () =>
  typeof navigator !== "undefined" &&
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * Save a blob as a file download.
 *
 * Mobile problem: programmatic <a>.click() with a blob URL is silently blocked
 * on iOS Safari and some Android browsers — the progress bar finishes but
 * nothing saves to the device.
 *
 * Fix: on mobile, use window.open(blobUrl) which triggers the browser's native
 * "Open In / Save to Files" sheet on iOS, and the download notification on Android.
 * We still attempt <a>.click() first in case the browser supports it.
 */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);

  // Always attempt <a download> — works on desktop and newer mobile browsers
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  if (isMobile()) {
    // On mobile, also open in new tab to show native Save UI
    // Small delay so the two don't race
    setTimeout(() => window.open(url, "_blank"), 300);
  }

  // Revoke after enough time for both paths
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [selectedFormat, setSelectedFormat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>("idle");
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadSpeed, setDownloadSpeed] = useState("");
  const [downloadEta, setDownloadEta] = useState("");
  const [audioStatus, setAudioStatus] = useState<DownloadStatus>("idle");
  const [audioProgress, setAudioProgress] = useState<number | null>(null);

  // ─── Theme ────────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(prefersDark ? 'dark' : 'light');
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  }, []);

  const activeItem = mediaInfo?.items[activeItemIndex] || null;
  const isCarousel = (mediaInfo?.items.length || 0) > 1;
  const selectedFormatObj = activeItem?.formats.find(f => f.format_id === selectedFormat);

  // This only fires for video-only streams (Twitter/Facebook sometimes do this)
  const needsBrowserMerge =
    !!selectedFormatObj && !selectedFormatObj.has_audio && !!activeItem?.audio_url;

  const handleSelectItem = (index: number) => {
    setActiveItemIndex(index);
    setDownloadStatus("idle");
    setDownloadProgress(null);
    const item = mediaInfo?.items[index];
    if (item?.formats?.length) setSelectedFormat(item.formats[0].format_id);
  };

  // ─── Analyze ──────────────────────────────────────────────────────────────────
  const handleAnalyze = useCallback(async (url: string) => {
    setIsAnalyzing(true);
    setError(null);
    setMediaInfo(null);
    setActiveItemIndex(0);
    setDownloadStatus("idle");
    setDownloadProgress(null);
    setAudioStatus("idle");
    setAudioProgress(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Analysis failed"); return; }
      setMediaInfo(data);
      if (data.items?.[0]?.formats?.length > 0) {
        setSelectedFormat(data.items[0].formats[0].format_id);
      }
    } catch {
      setError("Failed to connect to server. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  // ─── Download ──────────────────────────────────────────────────────────────────
  const handleDownloadItem = useCallback(async () => {
    if (!mediaInfo || !activeItem) return;

    setDownloadStatus("downloading");
    setDownloadProgress(0);
    setDownloadSpeed("");
    setDownloadEta("");
    setError(null);

    const platform = mediaInfo.platform;

    try {
      const format =
        activeItem.type === "video" && activeItem.formats.length > 0
          ? (activeItem.formats.find(f => f.format_id === selectedFormat) || activeItem.formats[0])
          : null;

      let blob: Blob;
      let filename: string;

      // ── PHOTO ──────────────────────────────────────────────────────────────
      if (activeItem.type === "photo") {
        const cdnUrl = activeItem.direct_url;
        if (!cdnUrl) throw new Error("No download URL available for this photo");

        if (cdnUrl.startsWith("data:")) {
          const res = await fetch(cdnUrl);
          blob = await res.blob();
          filename = `${platform}_photo_${activeItemIndex + 1}.${getImageExtFromDataUrl(cdnUrl)}`;
          setDownloadProgress(100);

        } else if (cdnUrl.startsWith("/api/")) {
          const res = await fetch(cdnUrl);
          if (!res.ok) throw new Error(`Download failed (${res.status})`);
          blob = await res.blob();
          filename = `${platform}_photo_${activeItemIndex + 1}.${await getImageExtFromBlob(blob)}`;
          setDownloadProgress(100);

        } else {
          const data = await fetchWithProgress(cdnUrl, `photo_${activeItemIndex + 1}`, pct => setDownloadProgress(pct));
          const ext = getImageExtFromBytes(data);
          blob = new Blob([data as BlobPart], { type: `image/${ext === "jpg" ? "jpeg" : ext}` });
          filename = `${platform}_photo_${activeItemIndex + 1}.${ext}`;
        }

        // ── VIDEO: combined format (has_audio=true) — direct proxy fetch ────────
        // Twitter/Facebook/Instagram combined formats land here
      } else if (format?.url && format.has_audio) {
        filename = `${platform}_${format.quality}.${format.ext || "mp4"}`;

        if (isM3u8Url(format.url)) {
          blob = await downloadM3u8Video(format.url, "output.mp4", (p: FFmpegProgress) => {
            setDownloadProgress(p.percent);
            setDownloadSpeed(p.message);
          });
        } else if (format.url.startsWith("/api/")) {
          const res = await fetch(format.url);
          if (!res.ok) throw new Error(`Download failed (${res.status})`);
          blob = await res.blob();
          setDownloadProgress(100);
        } else {
          const data = await fetchWithProgress(
            format.url,
            filename,
            pct => setDownloadProgress(pct)
          );
          blob = new Blob([data as BlobPart], { type: "video/mp4" });
        }

        // ── VIDEO: video-only needing browser merge (edge cases) ────
      } else if (format?.url && !format.has_audio && activeItem.audio_url) {
        filename = `${platform}_${format.quality}.mp4`;
        const { mergeVideoAudio } = await import("@/lib/ffmpeg-client");
        blob = await mergeVideoAudio(
          format.url,
          activeItem.audio_url,
          "output.mp4",
          (p: FFmpegProgress) => {
            switch (p.phase) {
              case "loading": setDownloadSpeed("Loading FFmpeg..."); setDownloadProgress(0); break;
              case "downloading_video": setDownloadSpeed("Video stream..."); setDownloadProgress(Math.round(p.percent * 0.4)); break;
              case "downloading_audio": setDownloadSpeed("Audio stream..."); setDownloadProgress(40 + Math.round(p.percent * 0.1)); break;
              case "merging":
                setDownloadStatus("merging");
                setDownloadSpeed("Merging...");
                setDownloadProgress(50 + Math.round(p.percent * 0.5));
                break;
            }
          }
        );

        // ── FALLBACK ────────────────────────────────────────────────────────────
      } else if (activeItem.direct_url) {
        filename = `${platform}_media_${activeItemIndex + 1}.mp4`;
        if (activeItem.direct_url.startsWith("/api/")) {
          const res = await fetch(activeItem.direct_url);
          if (!res.ok) throw new Error(`Download failed (${res.status})`);
          blob = await res.blob();
        } else {
          const data = await fetchWithProgress(activeItem.direct_url, filename, pct => setDownloadProgress(pct));
          blob = new Blob([data as BlobPart], { type: "video/mp4" });
        }
      } else {
        throw new Error("No download URL available for this item");
      }

      saveBlob(blob, filename);
      setDownloadStatus("complete");
      setDownloadProgress(100);

    } catch (err) {
      setDownloadStatus("error");
      setError(err instanceof Error ? err.message : "Download failed");
    }
  }, [mediaInfo, activeItem, selectedFormat, activeItemIndex]);

  // ─── Audio Download ────────────────────────────────────────────────────────────
  const handleDownloadAudio = useCallback(async () => {
    if (!mediaInfo || !activeItem) return;
    setAudioStatus("downloading");
    setAudioProgress(0);
    setError(null);

    try {
      let audioUrl = activeItem.audio_url;
      if (!audioUrl) {
        const af = activeItem.formats.find(f => f.has_audio && f.url);
        if (af?.url) audioUrl = af.url;
      }
      if (!audioUrl) throw new Error("No audio stream available");

      const safeTitle = mediaInfo.title.slice(0, 50).replace(/[^a-zA-Z0-9\s-]/g, "").trim();
      const filename = `${mediaInfo.platform}_audio_${safeTitle || "audio"}.mp3`;

      const blob = await extractAudio(audioUrl, "output.mp3", (p: FFmpegProgress) => {
        switch (p.phase) {
          case "loading": setAudioProgress(0); break;
          case "downloading_audio": setAudioProgress(Math.round(p.percent * 0.6)); break;
          case "converting":
            setAudioStatus("merging");
            setAudioProgress(60 + Math.round(p.percent * 0.4));
            break;
        }
      });

      saveBlob(blob, filename);
      setAudioStatus("complete");
      setAudioProgress(100);
    } catch (err) {
      setAudioStatus("error");
      setError(err instanceof Error ? err.message : "Audio download failed");
    }
  }, [mediaInfo, activeItem]);

  // ─── Download All (ZIP) ────────────────────────────────────────────────────────
  const handleDownloadAll = useCallback(async () => {
    if (!mediaInfo) return;
    setDownloadStatus("downloading");
    setDownloadProgress(0);
    setDownloadSpeed("Preparing...");
    setDownloadEta("");
    setError(null);

    try {
      const zip = new JSZip();
      const items = mediaInfo.items;
      const total = items.length;

      for (let i = 0; i < total; i++) {
        setDownloadProgress(Math.round((i / total) * 88));
        setDownloadSpeed(`Item ${i + 1} of ${total}...`);

        const item = items[i];
        let cdnUrl = "";
        if (item.direct_url?.startsWith("data:") || item.direct_url?.startsWith("http") || item.direct_url?.startsWith("/api/")) {
          cdnUrl = item.direct_url;
        } else if (item.formats[0]?.url) {
          cdnUrl = item.formats[0].url;
        }
        if (!cdnUrl) continue;

        let blob: Blob;
        let filename: string;

        if (cdnUrl.startsWith("data:")) {
          blob = await (await fetch(cdnUrl)).blob();
          const ext = item.type === "photo" ? getImageExtFromDataUrl(cdnUrl) : "mp4";
          filename = `${mediaInfo.platform}_${item.type}_${i + 1}.${ext}`;
        } else if (cdnUrl.startsWith("/api/")) {
          const res = await fetch(cdnUrl);
          if (!res.ok) throw new Error(`Item ${i + 1} failed`);
          blob = await res.blob();
          const ext = item.type === "photo" ? await getImageExtFromBlob(blob) : "mp4";
          filename = `${mediaInfo.platform}_${item.type}_${i + 1}.${ext}`;
        } else {
          const perShare = 88 / total;
          const data = await fetchWithProgress(cdnUrl, `item_${i + 1}`, pct =>
            setDownloadProgress(Math.round(i * perShare + (pct / 100) * perShare))
          );
          if (item.type === "photo") {
            const ext = getImageExtFromBytes(data);
            blob = new Blob([data as BlobPart], { type: `image/${ext === "jpg" ? "jpeg" : ext}` });
            filename = `${mediaInfo.platform}_photo_${i + 1}.${ext}`;
          } else {
            blob = new Blob([data as BlobPart], { type: "video/mp4" });
            filename = `${mediaInfo.platform}_video_${i + 1}.${item.formats[0]?.ext || "mp4"}`;
          }
        }
        zip.file(filename, blob);
      }

      setDownloadProgress(90);
      setDownloadSpeed("Creating ZIP...");
      setDownloadStatus("merging");

      const safeTitle = mediaInfo.title.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "_");
      const zipBlob = await zip.generateAsync(
        { type: "blob", compression: "DEFLATE", compressionOptions: { level: 1 } },
        meta => setDownloadProgress(90 + Math.round(meta.percent * 0.1))
      );

      saveBlob(zipBlob, `${mediaInfo.platform}_${safeTitle}_all.zip`);
      setDownloadStatus("complete");
      setDownloadProgress(100);
      setDownloadSpeed("");
    } catch (err) {
      setDownloadStatus("error");
      setError(err instanceof Error ? err.message : "Download failed");
    }
  }, [mediaInfo]);

  const mobile = isMobile();

  return (
    <div className="page-root" data-theme={theme}>

      {/* Ambient glows */}
      <div className="glow-layer" aria-hidden="true">
        <div className="glow glow-purple" />
        <div className="glow glow-blue" />
      </div>

      {/* ── Navbar ── */}
      <nav className="navbar">
        <div className="navbar-logo">
          <svg
            className="navbar-logo-icon"
            width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>MediaGrab</span>
        </div>
        <div className="navbar-actions">
          <button
            className="nav-icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/>
                <line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <main className="hero">
        <div className="hero-content">

          <h1 className="hero-title">
            <span className="sparkle" aria-hidden="true">✦</span>
            Save from{" "}
            <span className="gradient-text">Any Platform</span>
            <span className="sparkle" aria-hidden="true">✦</span>
          </h1>

          <p className="hero-sub">
            Download videos, reels, and photos from Instagram, Twitter/X, and Facebook.
            <br />
            <span className="hero-highlight">Free, fast, and instant.</span>
          </p>

          <div className="feature-badges">
            <span className="feature-badge">🔒 Secure</span>
            <span className="feature-badge">⚡ Fast</span>
            <span className="feature-badge">🤍 Free</span>
          </div>

          {/* URL Input */}
          <div className="input-section">
            <UrlInput
              onAnalyze={handleAnalyze}
              isLoading={isAnalyzing}
              detectedPlatform={mediaInfo?.platform || null}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="error-text animate-fade-up">
              <span className="error-dot" aria-hidden="true" />
              {error}
            </p>
          )}

          {/* Supported platforms — shown only before any URL is analysed */}
          {!mediaInfo && (
            <div className="supported-strip animate-fade-up">
              <span className="supported-label">🌐 Supported:</span>
              {[
                { key: "instagram", name: "Instagram" },
                { key: "twitter",   name: "X / Twitter" },
                { key: "facebook",  name: "Facebook" },
              ].map((p) => (
                <span key={p.key} className="platform-pill">
                  <PlatformLogo platform={p.key} size={13} />
                  {p.name}
                </span>
              ))}
            </div>
          )}

          {/* ── Results ── */}
          {mediaInfo && (
            <div className="results-area animate-fade-up">

              <PreviewCard
                platform={mediaInfo.platform}
                title={mediaInfo.title}
                uploader={mediaInfo.uploader}
                items={mediaInfo.items}
                activeIndex={activeItemIndex}
                onSelectItem={handleSelectItem}
              />

              {activeItem?.type === "video" && activeItem.formats.length > 0 && (
                <QualitySelector
                  formats={activeItem.formats}
                  selectedFormat={selectedFormat}
                  onSelect={(id) => {
                    setSelectedFormat(id);
                    setDownloadStatus("idle");
                    setDownloadProgress(null);
                  }}
                  disabled={downloadStatus === "downloading" || downloadStatus === "merging"}
                />
              )}

              {needsBrowserMerge && downloadStatus === "idle" && (
                <div className="merge-notice animate-fade-up">
                  ⚡ <strong>{selectedFormatObj?.quality}</strong> merges video + audio in your browser
                  {mobile ? " — may be slow on mobile." : "."}
                </div>
              )}

              <DownloadButton
                onClick={handleDownloadItem}
                onAudio={activeItem?.type === "video" ? handleDownloadAudio : undefined}
                onDownloadAll={isCarousel ? handleDownloadAll : undefined}
                progress={downloadProgress}
                status={downloadStatus}
                audioProgress={audioProgress}
                audioStatus={audioStatus}
                speed={downloadSpeed}
                eta={downloadEta}
                disabled={!mediaInfo}
                itemType={activeItem?.type}
                isCarousel={isCarousel}
                isVideo={activeItem?.type === "video"}
                photoCount={mediaInfo.items.filter((i) => i.type === "photo").length}
                videoCount={mediaInfo.items.filter((i) => i.type === "video").length}
              />

              {mobile && downloadStatus === "complete" && (
                <p className="mobile-tip">
                  📱 iOS: tap <strong>Share → Save to Files</strong> in the new tab.
                  Android: check your <strong>Downloads</strong> folder.
                </p>
              )}

            </div>
          )}

        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="site-footer">
        MediaGrab · Personal use only · Respect content creators
      </footer>

    </div>
  );
}
