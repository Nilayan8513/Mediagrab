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
  proxyDownload,
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

  const handleSelectItem = (index: number) => {
    setActiveItemIndex(index);
    setDownloadStatus("idle");
    const item = mediaInfo?.items[index];
    if (item?.formats?.length) {
      setSelectedFormat(item.formats[0].format_id);
    }
  };

  // ─── Analyze (server-side — lightweight metadata extraction only) ─────────────
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

      if (!res.ok) {
        setError(data.error || "Analysis failed");
        return;
      }

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

  // ─── ALL Downloads Are Client-Side ──────────────────────────────────────────
  // Server only does analysis. ALL downloads happen in the browser:
  //   • Combined formats (has_audio) → proxy download
  //   • Video-only formats (YouTube 1080p+) → proxy download video + audio → merge in browser (FFmpeg.wasm)
  //   • Audio extraction → proxy download audio stream → convert to MP3 in browser (FFmpeg.wasm)
  //   • Photos → proxy download
  //   • Instagram → proxy download from CDN URL

  const handleDownloadItem = useCallback(async () => {
    if (!mediaInfo || !activeItem) return;

    setDownloadStatus("downloading");
    setDownloadProgress(0);
    setDownloadSpeed("");
    setDownloadEta("");
    setError(null);

    try {
      const format = activeItem.type === "video" && activeItem.formats.length > 0
        ? (activeItem.formats.find(f => f.format_id === selectedFormat) || activeItem.formats[0])
        : null;

      let blob: Blob;
      let filename: string;

      if (activeItem.type === "photo") {
        // ── PHOTO: proxy download from CDN URL ──
        const cdnUrl = activeItem.direct_url;
        if (!cdnUrl || !cdnUrl.startsWith("http")) {
          throw new Error("No download URL available for this photo");
        }
        filename = `${mediaInfo.platform}_photo_${activeItemIndex + 1}.jpg`;
        blob = await proxyDownload(cdnUrl, filename, (pct) => {
          setDownloadProgress(pct);
        });
      } else if (mediaInfo.platform === "twitter" || mediaInfo.platform === "facebook") {
        // ── TWITTER/FACEBOOK: server-side download (m3u8 streams can't be proxied) ──
        filename = `${mediaInfo.platform}_video_${format?.quality || "best"}.mp4`;
        const downloadId = `dl_${Date.now()}`;
        const res = await fetch("/api/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: mediaInfo.original_url,
            downloadId,
            formatId: selectedFormat || "best",
            itemType: "video",
            itemIndex: activeItem.index,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || "Download failed");
        }
        blob = await res.blob();
      } else if (format && format.url && format.has_audio) {
        // ── VIDEO (combined — already has audio): proxy download ──
        // Works for: YouTube Cobalt URLs, Instagram CDN URLs
        filename = `${mediaInfo.platform}_video_${format.quality}.${format.ext || "mp4"}`;
        blob = await proxyDownload(format.url, filename, (pct) => {
          setDownloadProgress(pct);
        });
      } else if (format && format.url && !format.has_audio && activeItem.audio_url) {
        // ── VIDEO-ONLY (YouTube 1080p+ via yt-dlp): download video + audio → merge in browser ──
        filename = `${mediaInfo.platform}_video_${format.quality}.mp4`;
        setDownloadStatus("downloading");

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
                setDownloadSpeed("Downloading video...");
                setDownloadProgress(Math.round(p.percent * 0.4)); // 0-40%
                break;
              case "downloading_audio":
                setDownloadSpeed("Downloading audio...");
                setDownloadProgress(40 + Math.round(p.percent * 0.2)); // 40-60%
                break;
              case "merging":
                setDownloadStatus("merging");
                setDownloadSpeed("Merging in browser...");
                setDownloadProgress(60 + Math.round(p.percent * 0.4)); // 60-100%
                break;
            }
          }
        );
      } else if (format && format.url) {
        // ── VIDEO with URL but no audio info — try direct download ──
        filename = `${mediaInfo.platform}_video_${format.quality}.${format.ext || "mp4"}`;
        blob = await proxyDownload(format.url, filename, (pct) => {
          setDownloadProgress(pct);
        });
      } else if (activeItem.direct_url?.startsWith("http")) {
        // ── Fallback: direct URL ──
        const ext = (activeItem.type as string) === "photo" ? "jpg" : "mp4";
        filename = `${mediaInfo.platform}_media_${activeItemIndex + 1}.${ext}`;
        blob = await proxyDownload(activeItem.direct_url, filename, (pct) => {
          setDownloadProgress(pct);
        });
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

  // ─── Audio Download (client-side via FFmpeg.wasm) ────────────────────────────
  const handleDownloadAudio = useCallback(async () => {
    if (!mediaInfo || !activeItem) return;
    setAudioStatus("downloading");
    setAudioProgress(0);
    setError(null);

    try {
      // Find the best audio stream URL
      let audioUrl = activeItem.audio_url;
      if (!audioUrl) {
        // Try to find an audio-only format
        const audioFormat = activeItem.formats.find(f => f.has_audio && f.url);
        if (audioFormat?.url) {
          audioUrl = audioFormat.url;
        }
      }

      // For combined formats, use the format's URL directly
      if (!audioUrl) {
        const combined = activeItem.formats.find(f => f.has_audio && f.url);
        if (combined?.url) {
          audioUrl = combined.url;
        }
      }

      if (!audioUrl) {
        throw new Error("No audio stream available for this item");
      }

      const filename = `${mediaInfo.platform}_audio_${mediaInfo.title.slice(0, 50)}.mp3`;

      const blob = await extractAudio(
        audioUrl,
        "output.mp3",
        (p: FFmpegProgress) => {
          switch (p.phase) {
            case "loading":
              setAudioProgress(0);
              break;
            case "downloading_audio":
              setAudioProgress(Math.round(p.percent * 0.6)); // 0-60%
              break;
            case "converting":
              setAudioStatus("merging"); // reuse merging state for "converting"
              setAudioProgress(60 + Math.round(p.percent * 0.4)); // 60-100%
              break;
          }
        }
      );

      triggerDownload(blob, filename);
      setAudioStatus("complete");
      setAudioProgress(100);
    } catch (err) {
      setAudioStatus("error");
      setError(err instanceof Error ? err.message : "Audio download failed");
    }
  }, [mediaInfo, activeItem]);

  // ─── Download All (Carousel) — client-side ───────────────────────────────────
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

        if (item.direct_url?.startsWith("http")) {
          cdnUrl = item.direct_url;
          const ext = item.type === "photo" ? "jpg" : "mp4";
          filename = `${mediaInfo.platform}_${item.type}_${i + 1}.${ext}`;
        } else if (item.formats.length > 0 && item.formats[0].url) {
          cdnUrl = item.formats[0].url;
          filename = `${mediaInfo.platform}_video_${i + 1}.${item.formats[0].ext || "mp4"}`;
        }

        if (cdnUrl) {
          const blob = await proxyDownload(cdnUrl, filename);
          triggerDownload(blob, filename);
          // Delay between downloads to prevent browser throttling
          await new Promise(r => setTimeout(r, 500));
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
        {/* Platform logos */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {platforms.map((p) => (
            <div
              key={p.key}
              className="card-sm w-10 h-10 flex items-center justify-center cursor-default"
              title={p.name}
            >
              <PlatformLogo platform={p.key} size={22} />
            </div>
          ))}
        </div>

        {/* Title */}
        <div className="text-center mb-8 max-w-md">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2" style={{ color: "var(--text-primary)" }}>
            Media<span style={{ color: "var(--accent)" }}>Grab</span>
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "15px", lineHeight: "1.6" }}>
            Download videos, photos and reels from your favorite platforms.
          </p>
        </div>

        {/* Main Card */}
        <div className="card w-full max-w-lg p-6 sm:p-8 space-y-5">
          <UrlInput
            onAnalyze={handleAnalyze}
            isLoading={isAnalyzing}
            detectedPlatform={mediaInfo?.platform || null}
          />

          {/* Error */}
          {error && (
            <div
              className="animate-fade-up flex items-start gap-2.5 px-4 py-3 rounded-12 text-sm"
              style={{
                background: "var(--error-bg)",
                color: "var(--error)",
                borderRadius: "12px",
              }}
            >
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Preview */}
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

          {/* Quality Selector */}
          {activeItem && activeItem.type === "video" && activeItem.formats.length > 0 && (
            <QualitySelector
              formats={activeItem.formats}
              selectedFormat={selectedFormat}
              onSelect={setSelectedFormat}
              disabled={downloadStatus === "downloading" || downloadStatus === "merging"}
            />
          )}

          {/* Download */}
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

      {/* Footer */}
      <footer className="text-center py-6" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
        <p>MediaGrab — For personal use only. Respect content creators&apos; rights.</p>
      </footer>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
