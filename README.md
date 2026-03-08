<div align="center">

# 🎬 MediaGrab

### Download videos, reels & photos from your favorite platforms — free & fast.

[![Live Demo](https://img.shields.io/badge/🚀%20Live%20Demo-mediagrab--6i5t.onrender.com-blue?style=for-the-badge)](https://mediagrab-6i5t.onrender.com/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Deployed on Render](https://img.shields.io/badge/Deployed%20on-Render-46E3B7?style=for-the-badge&logo=render)](https://render.com/)

---

<img src="https://mediagrab-6i5t.onrender.com/next.svg" width="120" alt="MediaGrab" />

</div>

---

## 🌐 Live

**[https://mediagrab-6i5t.onrender.com/](https://mediagrab-6i5t.onrender.com/)**

---

## ✨ Features

- 📸 **Instagram** — Videos, Reels, Photos, Carousels (mixed photo + video posts)
- 🐦 **Twitter / X** — Videos, GIFs, Photos (multi-media tweets)
- 📘 **Facebook** — Videos & Reels
- 🎵 **Audio Extraction** — Download MP3 audio from any video
- 📦 **Download All** — Carousel posts zipped and downloaded in one click
- 🔀 **Quality Selector** — Choose resolution before downloading
- ⚡ **Client-side Processing** — FFmpeg.wasm merges streams in the browser (no server storage)
- 📱 **Mobile Friendly** — Works on iOS and Android browsers
- 🌗 **Dark / Light Mode** — Respects system preference

---

## 🛠️ Tech Stack

### Frontend
![Next.js](https://img.shields.io/badge/Next.js-black?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)

### Backend & Processing
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![yt-dlp](https://img.shields.io/badge/yt--dlp-FF0000?style=flat-square&logo=youtube&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=flat-square&logo=ffmpeg&logoColor=white)
![Instaloader](https://img.shields.io/badge/Instaloader-E1306C?style=flat-square&logo=instagram&logoColor=white)

### Deployment
![Render](https://img.shields.io/badge/Render-46E3B7?style=flat-square&logo=render&logoColor=black)

---

## 🏗️ Architecture

```
User pastes URL
      │
      ▼
  detectPlatform()
      │
      ├── Instagram ──► instaloader (photos/carousels) → yt-dlp fallback
      │
      ├── Twitter/X ──► Syndication API (no auth) → yt-dlp fallback
      │
      └── Facebook ──► yt-dlp (videos/reels)
                             │
                             ▼
                    Client-side download
                    (FFmpeg.wasm for merging,
                     parallel chunk download,
                     JSZip for carousels)
```

---

## 🚀 Running Locally

### Prerequisites
- Node.js 18+
- Python 3.10+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation)
- [ffmpeg](https://ffmpeg.org/download.html)
- [instaloader](https://instaloader.github.io/) — `pip install instaloader`

### Setup

```bash
# Clone the repo
git clone https://github.com/Nilayan8513/social-media-downloader-backend.git
cd social-media-downloader-backend

# Install dependencies
npm install

# (Optional) Add cookies for authenticated platform downloads
# Place a Netscape-format cookies.txt in the project root
# See: https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp

# Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 🌍 Deploying to Render

1. Push to GitHub
2. Create a new **Web Service** on [Render](https://render.com/)
3. Set **Build Command:** `npm install && npm run build`
4. Set **Start Command:** `npm start`
5. Add environment variables (optional):

| Variable | Description |
|---|---|
| `YTDLP_COOKIES` | Base64-encoded `cookies.txt` for authenticated downloads |
| `INSTA_SESSION` | Base64-encoded instaloader session file |

To encode your cookies file:
```bash
# Linux / Mac
base64 -w 0 cookies.txt

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("cookies.txt"))
```

---

## 📁 Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── analyze/      # URL analysis endpoint
│   │   ├── download/     # Server-side download (audio, Instagram)
│   │   ├── progress/     # SSE download progress stream
│   │   ├── proxy/        # CORS proxy for CDN URLs
│   │   ├── serve-file/   # Temp file server
│   │   └── thumbnail/    # Thumbnail proxy
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx          # Main UI
├── components/
│   ├── DownloadButton.tsx
│   ├── PlatformBadge.tsx
│   ├── PlatformLogos.tsx
│   ├── PreviewCard.tsx
│   ├── QualitySelector.tsx
│   └── UrlInput.tsx
└── lib/
    ├── ffmpeg-client.ts   # Client-side FFmpeg (merge, extract, HLS)
    ├── instaloader.ts     # Instagram photo/carousel handler
    ├── twitter-scraper.ts # Twitter Syndication API
    ├── facebook-scraper.ts
    └── ytdlp.ts           # Core platform routing + yt-dlp wrapper
```

---

## ⚠️ Disclaimer

MediaGrab is intended for **personal use only**. Always respect content creators' rights and the terms of service of each platform. Do not use this tool to download and redistribute copyrighted content.

---

## 👨‍💻 Author

**Nilayan** — CSE Student | Full Stack + ML

[![GitHub](https://img.shields.io/badge/GitHub-Nilayan8513-181717?style=flat-square&logo=github)](https://github.com/Nilayan8513)
