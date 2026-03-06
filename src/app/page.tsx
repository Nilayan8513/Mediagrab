"use client";

import { useState, useCallback } from "react";
import UrlInput from "@/components/UrlInput";
import PreviewCard from "@/components/PreviewCard";
import QualitySelector from "@/components/QualitySelector";
import DownloadButton from "@/components/DownloadButton";
import { PlatformLogo } from "@/components/PlatformLogos";
import {
  mergeVideoAudio,
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

const HIGH_QUALITY_LABELS = new Set(["4K", "1440p", "8K"]);

// Platforms where ALL downloads must be direct browser fetch (IP-locked CDN URLs with CORS)
const DIRECT_FETCH_PLATFORMS = new Set(["youtube"]);

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

  const activeItem = mediaInfo?.items[activeItemIndex] || null;
  const isCarousel = (mediaInfo?.items.length || 0) > 1;

  const selectedFormatObj = activeItem?.formats.find(
    (f) => f.format_id === selectedFormat
  );
  const needsBrowserMerge =
    selectedFormatObj && !selectedFormatObj.has_audio && !!activeItem?.audio_url;
  const isHighQuality =
    selectedFormatObj && HIGH_QUALITY_LABELS.has(selectedFormatObj.quality);

  const handleSelectItem = (index: number) => {
    setActiveItemIndex(index);
    setDownloadStatus("idle");
    const item = mediaInfo?.items[index];
    if (item?.formats?.length) setSelectedFormat(item.formats[0].format_id);
  };

  // ─── Analyze ─────────────────────────────────────────────────────────────────
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

  // ─── Download ─────────────────────────────────────────────────────────────────
  const handleDownloadItem = useCallback(async () => {
    if (!mediaInfo || !activeItem) return;

    setDownloadStatus("downloading");
    setDownloadProgress(0);
    setDownloadSpeed("");
    setDownloadEta("");
    setError(null);

    const platform = mediaInfo.platform;
    const isDirectPlatform = DIRECT_FETCH_PLATFORMS.has(platform);

    try {
      const format =
        activeItem.type === "video" && activeItem.formats.length > 0
          ? activeItem.formats.find((f) => f.format_id === selectedFormat) ||
          activeItem.formats[0]
          : null;

      let blob: Blob;
      let filename: string;

      if (activeItem.type === "photo") {
        // ── PHOTO ──
        const cdnUrl = activeItem.direct_url;
        if (!cdnUrl) throw new Error("No download URL available for this photo");
        filename = `${platform}_photo_${activeItemIndex + 1}.jpg`;
        if (cdnUrl.startsWith("data:")) {
          const res = await fetch(cdnUrl);
          blob = await res.blob();
          setDownloadProgress(100);
        } else if (cdnUrl.startsWith("/api/")) {
          const res = await fetch(cdnUrl);
          if (!res.ok) throw new Error(`Download failed (${res.status})`);
          blob = await res.blob();
        } else {
          const data = await fetchWithProgress(cdnUrl, filename, (pct) => setDownloadProgress(pct));
          blob = new Blob([data as BlobPart], { type: "image/jpeg" });
        }

      } else if (format && format.url && !format.has_audio && activeItem.audio_url) {
        // ── VIDEO-ONLY: needs merge (YouTube 1440p/4K, Twitter split streams) ──
        filename = `${platform}_${format.quality}.mp4`;
        blob = await mergeVideoAudio(
          format.url,
          activeItem.audio_url,
          "output.mp4",
          (p: FFmpegProgress) => {
            switch (p.phase) {
              case "loading":
                setDownloadSpeed("Loading FFmpeg...");
                setDownloadProgress(0);
                break;
              case "downloading_video":
                setDownloadSpeed("Downloading video stream...");
                setDownloadProgress(Math.round(p.percent * 0.4));
                break;
              case "downloading_audio":
                setDownloadSpeed("Downloading audio stream...");
                setDownloadProgress(40 + Math.round(p.percent * 0.1));
                break;
              case "merging":
                setDownloadStatus("merging");
                setDownloadSpeed("Merging in browser...");
                setDownloadProgress(50 + Math.round(p.percent * 0.5));
                break;
            }
          }
        );

      } else if (format && format.url && format.has_audio && isDirectPlatform) {
        // ── YOUTUBE/TWITTER COMBINED: direct browser fetch (IP-locked URL) ──
        // Must NOT go through server proxy — CDN URL is signed for browser's IP
        filename = `${platform}_${format.quality}.${format.ext || "mp4"}`;

        if (isM3u8Url(format.url)) {
          blob = await downloadM3u8Video(format.url, "output.mp4", (p: FFmpegProgress) => {
            setDownloadProgress(p.percent);
            setDownloadSpeed(p.message);
          });
        } else {
          // Direct fetch from browser — fetchWithProgress handles this correctly
          // because googlevideo.com and twimg.com are in shouldFetchDirectly()
          const data = await fetchWithProgress(
            format.url,
            filename,
            (pct) => setDownloadProgress(pct)
          );
          blob = new Blob([data as BlobPart], { type: "video/mp4" });
        }

      } else if (format && format.url) {
        // ── OTHER PLATFORMS (Instagram/Facebook): through proxy ──
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
        } else {
          const data = await fetchWithProgress(format.url, filename, (pct) => setDownloadProgress(pct));
          blob = new Blob([data as BlobPart], { type: "video/mp4" });
        }

      } else if (activeItem.direct_url) {
        // ── FALLBACK ──
        const ext = (activeItem as MediaItem).type === "photo" ? "jpg" : "mp4";
        filename = `${platform}_media_${activeItemIndex + 1}.${ext}`;
        if (activeItem.direct_url.startsWith("/api/")) {
          const res = await fetch(activeItem.direct_url);
          if (!res.ok) throw new Error(`Download failed (${res.status})`);
          blob = await res.blob();
        } else {
          const data = await fetchWithProgress(activeItem.direct_url, filename, (pct) => setDownloadProgress(pct));
          blob = new Blob([data as BlobPart], { type: ext === "jpg" ? "image/jpeg" : "video/mp4" });
        }
      } else {
        throw new Error("No download URL available for this item");
      }

      triggerDownload(blob, filename);
      setDownloadStatus("complete");
      setDownloadProgress(100);
    } catch (err) {
      setDownloadStatus("error");
      setError(err instanceof Error ? err.message : "Download failed");
    }
  }, [mediaInfo, activeItem, selectedFormat, activeItemIndex]);

  // ─── Audio Download ───────────────────────────────────────────────────────────
  const handleDownloadAudio = useCallback(async () => {
    if (!mediaInfo || !activeItem) return;
    setAudioStatus("downloading");
    setAudioProgress(0);
    setError(null);

    try {
      let audioUrl = activeItem.audio_url;
      if (!audioUrl) {
        const af = activeItem.formats.find((f) => f.has_audio && f.url);
        if (af?.url) audioUrl = af.url;
      }
      if (!audioUrl) throw new Error("No audio stream available for this item");

      const filename = `${mediaInfo.platform}_audio_${mediaInfo.title.slice(0, 50)}.mp3`;
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

      triggerDownload(blob, filename);
      setAudioStatus("complete");
      setAudioProgress(100);
    } catch (err) {
      setAudioStatus("error");
      setError(err instanceof Error ? err.message : "Audio download failed");
    }
  }, [mediaInfo, activeItem]);

  // ─── Download All ─────────────────────────────────────────────────────────────
  const handleDownloadAll = useCallback(async () => {
    if (!mediaInfo) return;
    setDownloadStatus("downloading");
    setDownloadProgress(0);
    setError(null);

    try {
      const items = mediaInfo.items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setDownloadProgress(Math.round((i / items.length) * 100));

        let cdnUrl = "";
        let filename = "";

        if (item.direct_url?.startsWith("data:") || item.direct_url?.startsWith("http") || item.direct_url?.startsWith("/api/")) {
          cdnUrl = item.direct_url;
          const ext = item.type === "photo" ? "jpg" : "mp4";
          filename = `${mediaInfo.platform}_${item.type}_${i + 1}.${ext}`;
        } else if (item.formats.length > 0 && item.formats[0].url) {
          cdnUrl = item.formats[0].url;
          filename = `${mediaInfo.platform}_video_${i + 1}.${item.formats[0].ext || "mp4"}`;
        }

        if (cdnUrl) {
          let blob: Blob;
          if (cdnUrl.startsWith("data:")) {
            blob = await (await fetch(cdnUrl)).blob();
          } else if (cdnUrl.startsWith("/api/")) {
            const res = await fetch(cdnUrl);
            if (!res.ok) throw new Error(`Download failed (${res.status})`);
            blob = await res.blob();
          } else {
            const data = await fetchWithProgress(cdnUrl, filename);
            blob = new Blob([data as BlobPart], { type: "video/mp4" });
          }
          triggerDownload(blob, filename);
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      setDownloadStatus("complete");
      setDownloadProgress(100);
    } catch (err) {
      setDownloadStatus("error");
      setError(err instanceof Error ? err.message : "Download failed");
    }
  }, [mediaInfo]);

  const platforms = [
    { name: "YouTube", key: "youtube" },
    { name: "Instagram", key: "instagram" },
    { name: "Twitter / X", key: "twitter" },
    { name: "Facebook", key: "facebook" },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex flex-col items-center px-4 sm:px-6 py-10 sm:py-16">
        <div className="flex items-center justify-center gap-3 mb-8">
          {platforms.map((p) => (
            <div key={p.key} className="card-sm w-10 h-10 flex items-center justify-center cursor-default" title={p.name}>
              <PlatformLogo platform={p.key} size={22} />
            </div>
          ))}
        </div>

        <div className="text-center mb-8 max-w-md">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2" style={{ color: "var(--text-primary)" }}>
            Media<span style={{ color: "var(--accent)" }}>Grab</span>
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "15px", lineHeight: "1.6" }}>
            Download videos, photos and reels from your favorite platforms.
          </p>
        </div>

        <div className="card w-full max-w-lg p-6 sm:p-8 space-y-5">
          <UrlInput onAnalyze={handleAnalyze} isLoading={isAnalyzing} detectedPlatform={mediaInfo?.platform || null} />

          {error && (
            <div className="animate-fade-up flex items-start gap-2.5 px-4 py-3 text-sm"
              style={{ background: "var(--error-bg)", color: "var(--error)", borderRadius: "12px" }}>
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {mediaInfo && (
            <PreviewCard
              platform={mediaInfo.platform}
              title={mediaInfo.title}
              uploader={mediaInfo.uploader}
              items={mediaInfo.items}
              activeIndex={activeItemIndex}
              onSelectItem={handleSelectItem}
            />
          )}

          {activeItem && activeItem.type === "video" && activeItem.formats.length > 0 && (
            <QualitySelector
              formats={activeItem.formats}
              selectedFormat={selectedFormat}
              onSelect={(id) => { setSelectedFormat(id); setDownloadStatus("idle"); setDownloadProgress(null); }}
              disabled={downloadStatus === "downloading" || downloadStatus === "merging"}
            />
          )}

          {/* 4K / 1440p browser-merge notice */}
          {needsBrowserMerge && isHighQuality && downloadStatus === "idle" && (
            <div className="animate-fade-up flex items-start gap-2.5 px-4 py-3 text-sm"
              style={{ background: "rgba(234,179,8,0.08)", color: "#ca8a04", borderRadius: "12px", border: "1px solid rgba(234,179,8,0.2)" }}>
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>
                <strong>{selectedFormatObj?.quality}</strong> requires merging video &amp; audio in your browser.
                This may take a few minutes and needs ~{selectedFormatObj?.quality === "4K" ? "4" : "2"}GB free RAM.
              </span>
            </div>
          )}

          {mediaInfo && activeItem && (
            <DownloadButton
              onClick={handleDownloadItem}
              onAudio={activeItem.type === "video" ? handleDownloadAudio : undefined}
              onDownloadAll={isCarousel ? handleDownloadAll : undefined}
              progress={downloadProgress}
              status={downloadStatus}
              audioProgress={audioProgress}
              audioStatus={audioStatus}
              speed={downloadSpeed}
              eta={downloadEta}
              disabled={!mediaInfo}
              itemType={activeItem.type}
              isCarousel={isCarousel}
              isVideo={activeItem.type === "video"}
            />
          )}
        </div>
      </main>

      <footer className="text-center py-6" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
        <p>MediaGrab — For personal use only. Respect content creators&apos; rights.</p>
      </footer>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}
