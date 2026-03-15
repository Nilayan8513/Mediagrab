<div align="center">

<br />

<img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Clapper%20Board.png" alt="MediaGrab" width="100" />

# MediaGrab

### *Your All-in-One Social Media Downloader*

**Download videos, reels, photos & audio from Instagram, Twitter/X, Facebook — all from one sleek interface.**

<br />

[![Next.js](https://img.shields.io/badge/Next.js-16.1.6-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2.3-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.0-06B6D4?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)

<br />

<p>
  <img src="https://img.shields.io/badge/Instagram-E4405F?style=for-the-badge&logo=instagram&logoColor=white" alt="Instagram" />
  <img src="https://img.shields.io/badge/Twitter%20/%20X-000000?style=for-the-badge&logo=x&logoColor=white" alt="Twitter / X" />
  <img src="https://img.shields.io/badge/Facebook-1877F2?style=for-the-badge&logo=facebook&logoColor=white" alt="Facebook" />
</p>

<br />

[![Live Site](https://img.shields.io/badge/🌐_Live_Site-https://mediagrab-production.up.railway.app/-4263eb?style=for-the-badge)](https://mediagrab-6i5t.onrender.com/)

<br />

---

</div>

<br />

## 📋 Table of Contents

- [Features](#-features)
- [Supported Platforms](#-supported-platforms)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Quick Start](#-quick-start)
- [Docker Deployment](#-docker-deployment)
- [Cloud Deployment](#-cloud-deployment)
- [Project Structure](#-project-structure)
- [API Reference](#-api-reference)
- [Configuration](#-configuration)
- [Security](#-security)
- [Contributing](#-contributing)
- [Author](#-author)
- [License & Disclaimer](#-license--disclaimer)

<br />

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🎯 Downloads
- 🎥 **Video Downloads** — Full quality from all platforms
- 🖼️ **Photo Downloads** — High-res images & albums
- 🎵 **Audio Extraction** — MP3 from any video
- 📦 **Carousel ZIP** — All items in one click
- 🔄 **Multi-Fallback** — Auto-retry with alternative scrapers

</td>
<td width="50%">

### 🎨 User Experience
- 🌗 **Dark / Light Mode** — System preference aware
- 📱 **Mobile Friendly** — iOS Safari & Android Chrome
- 📊 **Real-Time Progress** — Speed, ETA, percentage via SSE
- 🖼️ **Rich Previews** — Thumbnails, titles, uploader info
- ⚡ **Parallel Chunks** — Blazing fast large file downloads

</td>
</tr>
<tr>
<td>

### ⚙️ Processing
- 🔀 **Quality Selector** — Choose resolution before download
- 🧩 **Client-Side FFmpeg** — Video + audio merging in browser
- 🚫 **No Server Storage** — Media streams directly to you
- 📐 **Smart Detection** — Auto-detects platform from URL

</td>
<td>

### 🛡️ Reliability
- 🔁 **Instaloader → yt-dlp → Embed** fallback chain
- 🐦 **Twitter Syndication API** — No auth required
- 🍪 **Session Support** — Authenticated Instagram access
- 🐳 **Docker Ready** — One command deployment

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

<br />

---

## 🏗️ Tech Stack

<div align="center">

### Frontend
[![Next.js](https://img.shields.io/badge/Next.js_16-000?logo=next.js&logoColor=white&style=for-the-badge)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black&style=for-the-badge)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript_5.9-3178C6?logo=typescript&logoColor=white&style=for-the-badge)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_4-06B6D4?logo=tailwind-css&logoColor=white&style=for-the-badge)](https://tailwindcss.com/)
[![FFmpeg WASM](https://img.shields.io/badge/FFmpeg.wasm-007808?logo=ffmpeg&logoColor=white&style=for-the-badge)](https://ffmpegwasm.netlify.app/)

### Backend & CLI Tools
[![Node.js](https://img.shields.io/badge/Node.js_20-339933?logo=node.js&logoColor=white&style=for-the-badge)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python_3-3776AB?logo=python&logoColor=white&style=for-the-badge)](https://www.python.org/)
[![yt-dlp](https://img.shields.io/badge/yt--dlp-FF0000?logo=youtube&logoColor=white&style=for-the-badge)](https://github.com/yt-dlp/yt-dlp)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?logo=ffmpeg&logoColor=white&style=for-the-badge)](https://ffmpeg.org/)
[![Instaloader](https://img.shields.io/badge/Instaloader-E1306C?logo=instagram&logoColor=white&style=for-the-badge)](https://instaloader.github.io/)

### Deployment
[![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white&style=for-the-badge)](https://www.docker.com/)
[![Google Cloud](https://img.shields.io/badge/Cloud_Run-4285F4?logo=google-cloud&logoColor=white&style=for-the-badge)](https://cloud.google.com/run)
[![Render](https://img.shields.io/badge/Render-46E3B7?logo=render&logoColor=black&style=for-the-badge)](https://render.com/)

</div>

<br />

---

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER / BROWSER                             │
│                                                                     │
│   ┌──────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────────┐  │
│   │ UrlInput │→ │ PreviewCard  │→ │  Quality   │→ │  Download   │  │
│   │          │  │  + Carousel  │  │  Selector  │  │   Button    │  │
│   └──────────┘  └──────────────┘  └────────────┘  └──────┬──────┘  │
│                                                          │         │
│   ┌──────────────────────────────────────────────────────┘         │
│   │  FFmpeg.wasm (merge video+audio, extract MP3)                  │
│   │  JSZip (carousel → ZIP archive)                                │
│   │  Parallel chunk downloads (4 chunks, range requests)           │
│   └────────────────────────────────────────────────────────────────┘
│                               │                                     │
└───────────────────────────────┼─────────────────────────────────────┘
                                │ API Calls
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        NEXT.JS API ROUTES                           │
│                                                                     │
│   POST /api/analyze ──────► Platform Detection & Media Analysis     │
│   POST /api/download ─────► Server-side download + ZIP creation     │
│   GET  /api/progress ─────► SSE real-time progress stream           │
│   GET  /api/proxy ────────► CORS proxy (whitelisted CDN domains)    │
│   GET  /api/thumbnail ───► Cached thumbnail proxy (24h TTL)         │
│   POST /api/serve-file ──► Secure temp file delivery                │
│                                                                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       EXTRACTION ENGINES                            │
│                                                                     │
│   ┌─────────────┐  ┌────────────────┐  ┌────────────────────────┐  │
│   │  yt-dlp     │  │  Instaloader   │  │  Twitter Syndication   │  │
│   │  (primary)  │  │  (Instagram)   │  │  API (no auth needed)  │  │
│   └─────────────┘  └────────────────┘  └────────────────────────┘  │
│   ┌─────────────┐  ┌────────────────┐                              │
│   │  gallery-dl │  │  FB Photo      │     Multi-fallback chain:    │
│   │  (fallback) │  │  Scraper       │     instaloader → yt-dlp     │
│   └─────────────┘  └────────────────┘     → embed → gallery-dl     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

<br />

---

## ⚡ Quick Start

### Prerequisites

| Tool | Version | Required |
|------|---------|:--------:|
| ![Node.js](https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white&style=flat-square) Node.js | `>= 20` | ✅ |
| ![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white&style=flat-square) Python | `>= 3.10` | ✅ |
| ![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?logo=ffmpeg&logoColor=white&style=flat-square) FFmpeg | Latest | ✅ |
| ![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white&style=flat-square) Docker | Latest | Optional |

### 📦 Installation

```bash
# 1. Clone the repository
git clone https://github.com/Nilayan8513/social-media-downloader-backend.git
cd social-media-downloader-backend

# 2. Install Node.js dependencies
npm install

# 3. Install Python CLI tools
pip install "yt-dlp>=2023.11.16" "instaloader>=4.11" "gallery-dl>=1.26.0"
```

### 🚀 Run Development Server

```bash
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### 🏭 Production Build

```bash
npm run build
npm start
```

<br />

---

## 🐳 Docker Deployment

MediaGrab uses a **multi-stage Docker build** for an optimized production image:

```bash
# Build the image
docker build -t mediagrab .

# Run the container
docker run -d -p 3000:3000 mediagrab
```

**With environment variables:**

```bash
docker run -d -p 3000:3000 \
  -e YTDLP_COOKIES="<base64-encoded-cookies.txt>" \
  -e INSTA_SESSION="<base64-encoded-session>" \
  mediagrab
```

> **Docker image includes:** Node.js 20, Python 3, FFmpeg, yt-dlp, instaloader, gallery-dl — all pre-installed.

<br />

---

## 📂 Project Structure

```
MediaGrab/
│
├── 📁 src/
│   ├── 📁 app/
│   │   ├── page.tsx                  # Main application UI & download logic
│   │   ├── layout.tsx                # Root layout (fonts, metadata, theme)
│   │   ├── globals.css               # Design system — dark/light themes, animations
│   │   │
│   │   └── 📁 api/
│   │       ├── analyze/route.ts      # 🔍 URL analyzer — detect platform & extract media info
│   │       ├── download/route.ts     # ⬇️  Server-side download & ZIP creation
│   │       ├── progress/route.ts     # 📊 SSE real-time download progress stream
│   │       ├── proxy/route.ts        # 🌐 CORS proxy for CDN media (whitelisted domains)
│   │       ├── serve-file/route.ts   # 📄 Secure temp file serving (path-traversal protected)
│   │       └── thumbnail/route.ts    # 🖼️  Cached thumbnail proxy (24h TTL)
│   │
│   ├── 📁 components/
│   │   ├── UrlInput.tsx              # Smart URL input with paste & platform detection
│   │   ├── PreviewCard.tsx           # Media preview — thumbnail, title, carousel nav
│   │   ├── QualitySelector.tsx       # Resolution & format picker with file sizes
│   │   ├── DownloadButton.tsx        # Download UI — progress bar, speed, ETA
│   │   ├── PlatformBadge.tsx         # Platform indicator labels
│   │   └── PlatformLogos.tsx         # SVG brand logos for each platform
│   │
│   └── 📁 lib/
│       ├── ytdlp.ts                  # 🎯 Core orchestrator — platform detection & yt-dlp wrapper
│       ├── instaloader.ts            # 📸 Instagram scraper — photos, carousels, stories
│       ├── twitter-scraper.ts        # 🐦 Twitter/X Syndication API (no auth needed)
│       ├── facebook-photo.ts         # 📘 Facebook photo extractor (OG tags, CDN patterns)
│       └── ffmpeg-client.ts          # 🎬 Browser FFmpeg — chunked downloads, merge, extract
│
├── Dockerfile                        # Multi-stage production build
├── cloudbuild.yaml                   # Google Cloud Build CI/CD pipeline
├── next.config.ts                    # COOP/COEP headers for SharedArrayBuffer
├── package.json                      # Dependencies & scripts
├── requirements.txt                  # Python dependencies
└── cookies.txt                       # Optional: Netscape cookies for auth downloads
```

<br />

---

## 🔌 API Reference

<details>
<summary><b><code>POST</code> <code>/api/analyze</code></b> &nbsp;—&nbsp; Analyze a social media URL</summary>

<br />

**Request Body:**
```json
{
  "url": "https://www.instagram.com/p/ABC123/"
}
```

**Response:**
```json
{
  "platform": "instagram",
  "title": "Post by @username",
  "uploader": "username",
  "items": [
    {
      "type": "video",
      "thumbnail": "https://...",
      "formats": [
        { "id": "720p", "resolution": "1280x720", "filesize": 5242880 }
      ]
    }
  ]
}
```

Platform detection uses regex matching for Instagram, Twitter/X, Facebook, and YouTube URLs. Returns normalized `MediaInfo` objects regardless of source platform.

</details>

<details>
<summary><b><code>POST</code> <code>/api/download</code></b> &nbsp;—&nbsp; Download media file</summary>

<br />

**Request Body:**
```json
{
  "url": "https://www.instagram.com/p/ABC123/",
  "formatId": "720p",
  "itemType": "video",
  "directUrl": "https://...",
  "options": {
    "audioOnly": false,
    "useInstaloader": true,
    "useGalleryDl": false
  }
}
```

**Response:** Binary file stream with `Content-Disposition` header for browser download.

Supports audio-only extraction (MP3), carousel ZIP creation, and multiple download backends.

</details>

<details>
<summary><b><code>GET</code> <code>/api/progress?id={downloadId}</code></b> &nbsp;—&nbsp; Real-time progress via SSE</summary>

<br />

**Response** (Server-Sent Events, 500ms interval):
```
data: {"percent": 45, "speed": "2.5MB/s", "eta": "12s", "status": "downloading"}
data: {"percent": 100, "speed": "0", "eta": "0s", "status": "complete"}
```

Used by the `DownloadButton` component to display live progress bars with speed and ETA.

</details>

<details>
<summary><b><code>GET</code> <code>/api/proxy?url={encodedUrl}&filename={name}</code></b> &nbsp;—&nbsp; CORS media proxy</summary>

<br />

Streams media directly from whitelisted CDN domains to bypass CORS restrictions. **No server-side storage** — data flows through.

**Whitelisted domains:** `cdninstagram.com`, `fbcdn.net`, `pbs.twimg.com`, `video.twimg.com`, and more.

Unrecognized domains are rejected with `403 Forbidden`.

</details>

<details>
<summary><b><code>GET</code> <code>/api/thumbnail?url={encodedUrl}</code></b> &nbsp;—&nbsp; Cached thumbnail proxy</summary>

<br />

Proxies thumbnail images with cache headers (`public, max-age=86400` — 24 hours). Used by the `PreviewCard` component to display media thumbnails without CORS issues.

</details>

<details>
<summary><b><code>POST</code> <code>/api/serve-file</code></b> &nbsp;—&nbsp; Secure temp file server</summary>

<br />

Serves downloaded files from `/tmp`. Files must match a `mediagrab_*` prefix and reside within the temp directory — **path traversal is blocked**.

</details>

<br />

---

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|:--------:|
| `PORT` | Server port | `3000` | No |
| `NODE_ENV` | Environment mode | `production` (Docker) | Auto |
| `YTDLP_COOKIES` | Base64-encoded `cookies.txt` for authenticated platform downloads | — | No |
| `INSTA_SESSION` | Base64-encoded Instagram session pickle file | — | No |
| `INSTA_USERNAME` | Instagram username for session login | — | No |
| `INSTA_PASSWORD` | Instagram password for session login | — | No |

### Encoding Cookies

```bash
# Linux / macOS
base64 -w 0 cookies.txt

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("cookies.txt"))
```

> 💡 Cookies enable authenticated downloads for private/age-restricted content. See the [yt-dlp cookie docs](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp) for format details.

<br />

---

## 🔒 Security

| Feature | Description |
|---------|-------------|
| 🛡️ **COOP / COEP Headers** | Cross-Origin Isolation for `SharedArrayBuffer` (FFmpeg.wasm) |
| 🔐 **Path Traversal Protection** | Temp directory sandboxing + `mediagrab_` prefix validation |
| 🌐 **Domain Whitelisting** | Proxy only allows known CDN domains — rejects all others |
| 👤 **Non-Root Docker** | Container runs as unprivileged `nextjs` user |
| 📦 **Standalone Build** | No `node_modules` shipped in production image |
| 🔒 **Input Validation** | URL format verification before processing |

<br />

---

## 🛠️ NPM Scripts

```bash
npm run dev       # Start development server with hot reload
npm run build     # Create optimized production build
npm start         # Start production server
npm run lint      # Run ESLint checks
```

<br />

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

```
1. Fork the repository
2. Create your branch        →  git checkout -b feature/amazing-feature
3. Commit your changes       →  git commit -m "Add amazing feature"
4. Push to the branch        →  git push origin feature/amazing-feature
5. Open a Pull Request
```

<br />

---

## 👨‍💻 Author

<div align="left">

**Nilayan** — CSE Student | Full Stack + ML

[![GitHub](https://img.shields.io/badge/GitHub-Nilayan8513-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Nilayan8513)

</div>

<br />

---

## 📄 License & Disclaimer

This project is for **personal & educational use only**.

Always respect content creators' rights and each platform's Terms of Service. Do not use MediaGrab to download or redistribute copyrighted content without authorization.

<br />

---

<div align="center">

<br />

**If you found this project useful, give it a ⭐!**

<br />

<img src="https://img.shields.io/badge/Made_with-❤️-red?style=for-the-badge" />
<img src="https://img.shields.io/badge/Powered_by-Next.js-000?style=for-the-badge&logo=next.js" />
<img src="https://img.shields.io/badge/Open_Source-💚-green?style=for-the-badge" />

<br /><br />

</div>
