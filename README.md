# 🎬 MediaGrab

### Download videos, reels & photos from your favorite platforms — free & fast.

[![Live Site](https://img.shields.io/badge/🌐_Live_Site-mediagrab--6i5t.onrender.com-4263eb?style=for-the-badge)](https://mediagrab-6i5t.onrender.com/)

[![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![Render](https://img.shields.io/badge/Deployed_on-Render-46E3B7?style=for-the-badge&logo=render&logoColor=black)](https://render.com/)

---

## ✨ Features

- 📸 **Instagram** — Videos, Reels, Photos, Carousels (mixed photo + video posts)
- 🐦 **Twitter / X** — Videos, GIFs, Photos (multi-media tweets)
- 📘 **Facebook** — Videos & Reels only *(photo posts not supported — Facebook blocks server-side HTTP requests from cloud IPs like Render, making photo scraping impossible without a residential proxy)*
- 🎵 **Audio Extraction** — Download MP3 audio from any video
- 📦 **Download All** — Carousel posts zipped in one click
- 🔀 **Quality Selector** — Choose resolution before downloading
- ⚡ **Client-side Processing** — FFmpeg.wasm merges streams in the browser
- 📱 **Mobile Friendly** — Works on iOS and Android
- 🌗 **Dark / Light Mode** — Respects system preference

---

## 🛠️ Tech Stack

### Frontend
![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)

### Backend & Processing
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
![yt-dlp](https://img.shields.io/badge/yt--dlp-FF0000?style=for-the-badge&logo=youtube&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)

### Deployment
![Render](https://img.shields.io/badge/Render-46E3B7?style=for-the-badge&logo=render&logoColor=black)

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
git clone https://github.com/Nilayan8513/Mediagrab.git
cd Mediagrab

# Install dependencies
npm install

# Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

> **Note:** For authenticated downloads (Facebook, private Instagram), add a `cookies.txt` in the project root. See [yt-dlp cookie docs](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp). **Never commit cookies.txt to GitHub.**

---

## 🌍 Deploying to Render

1. Push to GitHub
2. Create a new **Web Service** on [Render](https://render.com/)
3. Set **Build Command:** `npm install && npm run build`
4. Set **Start Command:** `npm start`
5. Add environment variables:

| Variable | Description |
|---|---|
| `YTDLP_COOKIES` | Base64-encoded `cookies.txt` for authenticated downloads |
| `INSTA_SESSION` | Base64-encoded instaloader session file |

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
    ├── facebook-photo
    └── ytdlp.ts           # Core platform routing + yt-dlp wrapper
```

---

## ⚠️ Disclaimer

MediaGrab is intended for **personal use only**. Always respect content creators' rights and the terms of service of each platform. Do not use this tool to download and redistribute copyrighted content.

---

## 👨‍💻 Author

**Nilayan** — CSE Student | Full Stack + ML

[![GitHub](https://img.shields.io/badge/GitHub-Nilayan8513-181717?style=for-the-badge&logo=github)](https://github.com/Nilayan8513)
