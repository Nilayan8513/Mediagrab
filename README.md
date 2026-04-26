<div align="center">

<br />

<img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Clapper%20Board.png" alt="MediaGrab" width="100" />

# MediaGrab

### *Personal Media Bookmarking Tool*

**A self-hosted utility for saving your own social media content — posts, reels, and photos you've uploaded or have permission to download.**

<br />

[![Next.js](https://img.shields.io/badge/Next.js-16.1.6-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2.3-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

<br />

</div>



## 🎯 Intended Use Cases

- 📸 **Backing up your own posts** — Save copies of photos/videos you uploaded
- 🎓 **Educational projects** — Learning web scraping, API integration, and full-stack development
- 🗂️ **Archiving permitted content** — Save media you have explicit rights to
- 🛠️ **Developer portfolio** — Demonstrates Next.js, TypeScript, FFmpeg.wasm, SSE streaming

<br />

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🎯 Downloads
- 🎥 **Video Downloads** — Full quality up to 1080p
- 🖼️ **Photo Downloads** — High-res images & albums
- 🎵 **Audio Extraction** — MP3 from any video
- 📦 **Carousel ZIP** — All items in one click
- 🔄 **Multi-Fallback** — Auto-retry with alternative methods

</td>
<td width="50%">

### 🎨 User Experience
- 🌗 **Dark / Light Mode** — System preference aware
- 📱 **Mobile Friendly** — iOS Safari & Android Chrome
- 📊 **Real-Time Progress** — Speed, ETA & percentage via SSE
- 🖼️ **Rich Previews** — Thumbnails, titles & uploader info
- ⚡ **Parallel Chunks** — Fast large file downloads

</td>
</tr>
<tr>
<td>

### ⚙️ Processing
- 🔀 **Quality Selector** — Choose resolution before download
- 🧩 **Client-Side FFmpeg** — Video + audio merge in browser
- 🚫 **No Server Storage** — Media streams directly to you
- 📐 **Smart Detection** — Auto-detects platform from URL

</td>
<td>

### 🛡️ Reliability
- 🔁 **Multi-method fallback chain**
- 🐦 **Twitter Syndication API** — Public tweets only
- 🐳 **Docker Ready** — One command deployment
- 🔒 **Privacy First** — No data collection or tracking

</td>
</tr>
</table>

<br />

---

## 🌐 Supported Platforms

<div align="center">

| Platform | Videos | Photos | Reels | Stories | Audio | Carousel |
|:--------:|:------:|:------:|:-----:|:-------:|:-----:|:--------:|
| <img src="https://img.shields.io/badge/-Instagram-E4405F?logo=instagram&logoColor=white&style=flat-square" /> | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| <img src="https://img.shields.io/badge/-Twitter%20/%20X-000000?logo=x&logoColor=white&style=flat-square" /> | ✅ | ✅ | — | — | ✅ | ✅ |
| <img src="https://img.shields.io/badge/-Facebook-1877F2?logo=facebook&logoColor=white&style=flat-square" /> | ✅ | ✅ | ✅ | — | ✅ | — |

</div>

> **Note:** Only publicly available content or content you own/have permission to download should be accessed.

<br />

---

## 🏗️ Tech Stack

<div align="center">

| Layer | Technologies |
|-------|-------------|
| **Frontend** | Next.js 16 · React 19 · TypeScript · Vanilla CSS · FFmpeg.wasm |
| **Backend** | Node.js 20 · Next.js API Routes · SSE Progress Streaming |
| **Processing** | FFmpeg (server) · FFmpeg.wasm (browser) · JSZip |

</div>

<br />

---

## 🏛️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER / BROWSER                            │
│                                                                  │
│  UrlInput → PreviewCard → QualitySelector → DownloadButton       │
│                                                                  │
│  FFmpeg.wasm  (merge video+audio, extract MP3)                   │
│  JSZip        (carousel → ZIP archive)                           │
│  Parallel chunk downloads (4 chunks, range requests)             │
└──────────────────────┬───────────────────────────────────────────┘
                       │ API Calls
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    NEXT.JS API ROUTES                             │
│                                                                  │
│  POST /api/analyze ────► Platform detection & media analysis     │
│  POST /api/download ───► Server-side download + ZIP creation     │
│  GET  /api/progress ───► SSE real-time progress stream           │
│  GET  /api/proxy ──────► CORS proxy (whitelisted CDN domains)    │
│  GET  /api/thumbnail ──► Cached thumbnail proxy (24h TTL)        │
└──────────────────────────────────────────────────────────────────┘
```

<br />

---

## ⚡ Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| **Node.js** | `>= 20` |
| **Python** | `>= 3.10` |
| **FFmpeg** | Latest |

### Installation

```bash
# Clone the repository
git clone https://github.com/Nilayan8513/Mediagrab.git
cd Mediagrab

# Install dependencies
npm install
pip install "yt-dlp>=2023.11.16" "instaloader>=4.11" "gallery-dl>=1.26.0"

# Start dev server
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### Docker (Self-Hosted)

```bash
docker build -t mediagrab .
docker run -p 3000:3000 mediagrab
```

> This is intended for **personal, self-hosted use** on your own machine or private server.

<br />

---

## 📂 Project Structure

```
MediaGrab/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Main UI & download logic
│   │   ├── layout.tsx                # Root layout, fonts & metadata
│   │   ├── globals.css               # Design system — dark/light themes
│   │   └── api/
│   │       ├── analyze/route.ts      # URL analyzer — detect platform & extract media
│   │       ├── download/route.ts     # Server-side download & ZIP creation
│   │       ├── progress/route.ts     # SSE real-time progress stream
│   │       ├── proxy/route.ts        # CORS proxy for CDN media
│   │       ├── serve-file/route.ts   # Secure temp file serving
│   │       └── thumbnail/route.ts    # Cached thumbnail proxy
│   ├── components/
│   │   ├── UrlInput.tsx              # URL input with platform detection
│   │   ├── PreviewCard.tsx           # Media preview & carousel navigation
│   │   ├── QualitySelector.tsx       # Resolution picker with file sizes
│   │   ├── DownloadButton.tsx        # Download progress — speed & ETA
│   │   ├── PlatformBadge.tsx         # Platform indicator labels
│   │   └── PlatformLogos.tsx         # SVG brand logos
│   └── lib/
│       ├── ytdlp.ts                  # Core orchestrator — platform detection
│       ├── instaloader.ts            # Instagram handler
│       ├── twitter-scraper.ts        # Twitter Syndication API
│       ├── facebook-photo.ts         # Facebook photo extractor
│       └── ffmpeg-client.ts          # Browser FFmpeg — merge, extract, chunk downloads
├── Dockerfile                        # Multi-stage production build
├── next.config.ts                    # COOP/COEP headers for SharedArrayBuffer
└── package.json
```

<br />

---

## 🔌 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/analyze` | Detect platform from URL, extract media info & available formats |
| `POST` | `/api/download` | Server-side download with format selection, returns binary stream |
| `GET` | `/api/progress?id=` | SSE stream — live download progress with speed & ETA |
| `GET` | `/api/proxy?url=` | CORS proxy for whitelisted CDN domains (no server storage) |
| `GET` | `/api/thumbnail?url=` | Cached thumbnail proxy with 24h TTL |
| `POST` | `/api/serve-file` | Secure temp file delivery with path traversal protection |

<br />

---

## 🔒 Security

| Feature | Description |
|---------|-------------|
| **COOP / COEP Headers** | Cross-Origin Isolation for `SharedArrayBuffer` (FFmpeg.wasm) |
| **Path Traversal Protection** | Temp dir sandboxing + `mediagrab_` prefix validation |
| **Domain Whitelisting** | Proxy only allows known CDN domains |
| **Non-Root Docker** | Container runs as unprivileged `nextjs` user |
| **Input Validation** | URL format verification before processing |
| **No Data Collection** | No analytics, no tracking, no user data stored |

<br />

---

## 👨‍💻 Author

<div align="center">

**Nilayan** — CSE Student | Full Stack + ML

[![GitHub](https://img.shields.io/badge/GitHub-Nilayan8513-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Nilayan8513)

</div>

<br />

---

## 📄 License & Disclaimer

> **This project is intended strictly for personal and educational use.**
>
> MediaGrab is designed to help users download **their own content** or content they have **explicit permission** to save. It is the user's sole responsibility to comply with the Terms of Service of each platform and all applicable copyright laws.
>
> **The developer does not condone or encourage:**
> - Downloading copyrighted content without authorization
> - Scraping content that violates platform Terms of Service
> - Redistribution of any downloaded media
> - Circumventing access controls or authentication mechanisms
>
> **By using this tool, you accept full legal responsibility for your actions.** This software is provided "as is" without warranty. The developer is not liable for any misuse.

<br />

<div align="center">

**If you found this project useful, give it a ⭐!**

<br />

<img src="https://img.shields.io/badge/Made_with-❤️-red?style=for-the-badge" />
<img src="https://img.shields.io/badge/Powered_by-Next.js-000?style=for-the-badge&logo=next.js" />
<img src="https://img.shields.io/badge/Educational_Project-💚-green?style=for-the-badge" />

</div>
