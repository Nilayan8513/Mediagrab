"use client";

import { useState, useCallback } from "react";
import UrlInput from "@/components/UrlInput";
import PreviewCard from "@/components/PreviewCard";
import QualitySelector from "@/components/QualitySelector";
import DownloadButton from "@/components/DownloadButton";
import { PlatformLogo } from "@/components/PlatformLogos";

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

  // ─── Download via Proxy (works on ALL devices/browsers) ──────────────────────
  // ALL downloads go through /api/proxy which streams CDN → client.
  // This avoids CORS issues and works identically on mobile, desktop, any browser.

  const proxyDownload = useCallback(async (
    cdnUrl: string,
    filename: string,
    onProgress?: (percent: number) => void,
  ) => {
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(cdnUrl)}&filename=${encodeURIComponent(filename)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Download failed (${res.status})`);
    }

    const contentLength = res.headers.get("Content-Length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    if (!res.body) {
      // No streaming — fallback to blob
      const blob = await res.blob();
      triggerDownload(blob, filename);
      return;
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total > 0 && onProgress) {
        onProgress(Math.round((received / total) * 100));
      }
    }

    const blob = new Blob(chunks as BlobPart[]);
    triggerDownload(blob, filename);
  }, []);

  // ─── Server Download (yt-dlp merge, instaloader, etc.) ───────────────────────
  const serverDownload = useCallback(async (
    body: Record<string, unknown>,
    downloadId: string,
  ) => {
    const eventSource = new EventSource(`/api/progress?id=${downloadId}`);
    eventSource.onmessage = (event) => {
      try {
        const progress = JSON.parse(event.data);
        setDownloadProgress(progress.percent);
        setDownloadSpeed(progress.speed || "");
        setDownloadEta(progress.eta || "");
        if (progress.status === "merging") setDownloadStatus("merging");
      } catch { /* ignore */ }
    };

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      eventSource.close();

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Download failed");
      }

      await triggerBlobDownload(res);
    } finally {
      eventSource.close();
    }
  }, []);

  // ─── Main Download Handler ──────────────────────────────────────────────────
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

      // ── Check if we can use proxy download (CDN URL available + has audio) ──
      // For photos: use proxy if direct_url is a CDN URL (http)
      // For videos: use proxy only if format has BOTH video+audio (combined) and CDN URL
      // Otherwise: fall back to server-side yt-dlp download (handles merging)

      const canUseProxy = (() => {
        // Instagram always uses server-side (instaloader/yt-dlp download)
        if (mediaInfo.platform === "instagram") return false;

        // Photo with CDN URL
        if (activeItem.type === "photo" && activeItem.direct_url?.startsWith("http")) return true;

        // Video with combined format (has audio) and CDN URL
        if (format && format.url && format.has_audio) return true;

        return false;
      })();

      if (canUseProxy) {
        // ── PROXY DOWNLOAD (lightweight — server just pipes bytes) ──
        let cdnUrl = "";
        let filename = "";

        if (activeItem.type === "photo" && activeItem.direct_url) {
          cdnUrl = activeItem.direct_url;
          filename = `${mediaInfo.platform}_photo_${activeItemIndex + 1}.jpg`;
        } else if (format?.url) {
          cdnUrl = format.url;
          filename = `${mediaInfo.platform}_video_${format.quality}.${format.ext || "mp4"}`;
        }

        if (cdnUrl) {
          await proxyDownload(cdnUrl, filename, (percent) => {
            setDownloadProgress(percent);
          });
          setDownloadStatus("complete");
          setDownloadProgress(100);
          return;
        }
      }

      // ── SERVER DOWNLOAD (yt-dlp with merge, instaloader, etc.) ──
      const downloadId = `dl_${Date.now()}`;
      const body: Record<string, unknown> = {
        url: mediaInfo.original_url,
        downloadId,
        itemType: activeItem.type,
        itemIndex: activeItem.index,
      };

      if (activeItem.type === "photo" && activeItem.direct_url) {
        if (mediaInfo.platform === "instagram") {
          body.useInstaloader = true;
        } else {
          body.directUrl = activeItem.direct_url;
        }
      } else if (activeItem.type === "video") {
        if (mediaInfo.platform === "instagram") {
          // Instagram video — use yt-dlp server download (better than instaloader for videos)
          body.formatId = selectedFormat || "best";
        } else {
          body.formatId = selectedFormat;
        }
      } else if (activeItem.direct_url) {
        body.directUrl = activeItem.direct_url;
        if (mediaInfo.platform === "instagram") {
          body.useInstaloader = true;
        } else {
          body.useGalleryDl = true;
        }
      }

      await serverDownload(body, downloadId);
      setDownloadStatus("complete");
      setDownloadProgress(100);
    } catch (err) {
      setDownloadStatus("error");
      setError(err instanceof Error ? err.message : "Download failed");
    }
  }, [mediaInfo, activeItem, selectedFormat, activeItemIndex, proxyDownload, serverDownload]);

  // ─── Audio Download (always server-side — needs ffmpeg) ──────────────────────
  const handleDownloadAudio = useCallback(async () => {
    if (!mediaInfo) return;
    const downloadId = `audio_${Date.now()}`;
    setAudioStatus("downloading");
    setAudioProgress(0);

    const eventSource = new EventSource(`/api/progress?id=${downloadId}`);
    eventSource.onmessage = (event) => {
      try {
        const p = JSON.parse(event.data);
        setAudioProgress(p.percent);
        if (p.status === "merging") setAudioStatus("merging");
      } catch { /* ignore */ }
    };

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: mediaInfo.original_url,
          downloadId,
          audioOnly: true,
        }),
      });
      eventSource.close();
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Audio download failed");
      }
      await triggerBlobDownload(res);
      setAudioStatus("complete");
      setAudioProgress(100);
    } catch (err) {
      eventSource.close();
      setAudioStatus("error");
      setError(err instanceof Error ? err.message : "Audio download failed");
    }
  }, [mediaInfo]);

  // ─── Download All (Carousel) — server-side for zip packaging ─────────────────
  const handleDownloadAll = useCallback(async () => {
    if (!mediaInfo) return;

    const downloadId = `dlall_${Date.now()}`;
    setDownloadStatus("downloading");
    setDownloadProgress(0);

    const eventSource = new EventSource(`/api/progress?id=${downloadId}`);
    eventSource.onmessage = (event) => {
      try {
        const progress = JSON.parse(event.data);
        setDownloadProgress(progress.percent);
        setDownloadSpeed(progress.speed || "");
        setDownloadEta(progress.eta || "");
        if (progress.status === "merging") setDownloadStatus("merging");
      } catch { /* ignore */ }
    };

    try {
      const isInstagram = mediaInfo.platform === "instagram";
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: mediaInfo.original_url,
          downloadId,
          useGalleryDl: !isInstagram,
          useInstaloader: isInstagram,
        }),
      });

      eventSource.close();

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Download failed");
      }

      await triggerBlobDownload(res);
      setDownloadStatus("complete");
      setDownloadProgress(100);
    } catch (err) {
      eventSource.close();
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
        {/* Platform logos — top row */}
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

async function triggerBlobDownload(res: Response) {
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition");
  let filename = "download.mp4";
  if (disposition) {
    const match = disposition.match(/filename="?(.+?)"?$/);
    if (match) filename = decodeURIComponent(match[1]);
  }
  triggerDownload(blob, filename);
}
