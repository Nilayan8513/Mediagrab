# MediaGrab - Social Media Downloader

A minimal, modern web application to download videos, photos, and audio from YouTube, Instagram, X (Twitter), and Facebook.

## Prerequisites

This application relies on several external command-line tools. You need to install them before running the server.

### 1. Node.js

Ensure you have Node.js (v18+) installed.

### 2. Python Dependencies

The core downloading logic uses Python-based tools. Install them using `pip`:

```bash
pip install -r requirements.txt
```

This will install:
- `yt-dlp` (for YouTube, X, Facebook, and Instagram video fallback)
- `instaloader` (for Instagram photos and carousels)
- `gallery-dl` (backup downloader)

### 3. FFmpeg

Required for extracting audio (`MP3`) and generating thumbnail frames for downloaded videos.
- **Windows**: Download from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/), extract it, and add the `bin` folder to your system's PATH.
- **Mac**: `brew install ffmpeg`
- **Linux**: `sudo apt install ffmpeg`

## Installation

1. Clone the repository
2. Install Node dependencies:
   ```bash
   npm install
   ```

## Running the App

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Authentication (Cookies)

Some platforms (like Instagram stories or age-restricted YouTube videos) require you to be logged in.

1. Install a browser extension like "Get cookies.txt LOCALLY"
2. Go to the platform (e.g., instagram.com) and log in
3. Click the extension and export the cookies
4. Save the file as `cookies.txt` in the root directory of this project
5. The application will automatically detect and use these cookies

## License

Personal use only. Respect content creators' rights.
