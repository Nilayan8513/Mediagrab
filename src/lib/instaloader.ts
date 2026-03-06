import { spawn } from "child_process";
import { mkdirSync, existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join, basename, extname } from "path";
import { execSync } from "child_process";
import type { MediaInfo, MediaItem, Platform } from "./ytdlp";
import { setProgress } from "./ytdlp";

// ─── Instaloader: Instagram Photos, Carousels & Stories ───────────────────────

/**
 * Extract the shortcode from an Instagram URL.
 * e.g. https://www.instagram.com/p/ABC123/ → ABC123
 */
function extractShortcode(url: string): string | null {
    const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
}

/**
 * Extract story info from an Instagram story URL.
 * e.g. https://www.instagram.com/stories/username/1234567890/ → { username, storyId }
 */
function extractStoryInfo(url: string): { username: string; storyId: string | null } | null {
    const match = url.match(/instagram\.com\/stories\/([A-Za-z0-9_.]+)(?:\/(\d+))?/);
    if (!match) return null;
    return { username: match[1], storyId: match[2] || null };
}

/**
 * Get instaloader session/cookie args.
 * Supports multiple methods in priority order:
 * 1. INSTA_SESSION env var (base64-encoded instaloader session file)
 * 2. Convert cookies.txt / YTDLP_COOKIES into an instaloader session
 * 3. INSTA_USERNAME + INSTA_PASSWORD env vars
 * 4. INSTA_USERNAME with existing session
 */
function getSessionArgs(): string[] {
    // Method 1: INSTA_SESSION env var (base64-encoded session file)
    if (process.env.INSTA_SESSION) {
        try {
            const tempDir = process.env.TEMP || process.env.TMP || "/tmp";
            const sessionFile = join(tempDir, "instaloader_session");
            writeFileSync(
                sessionFile,
                Buffer.from(process.env.INSTA_SESSION, "base64")
            );
            return ["--sessionfile", sessionFile];
        } catch (err) {
            console.error("Failed to decode INSTA_SESSION env var:", err);
        }
    }

    // Method 2: Convert cookies.txt → instaloader session via Python
    // This reuses the same cookies from the Chrome extension (cookies.txt or YTDLP_COOKIES)
    const cookieSession = createSessionFromCookies();
    if (cookieSession) {
        return ["--sessionfile", cookieSession];
    }

    // Method 3: INSTA_USERNAME + INSTA_PASSWORD env vars
    if (process.env.INSTA_USERNAME && process.env.INSTA_PASSWORD) {
        return ["--login", process.env.INSTA_USERNAME];
    }

    // Method 4: INSTA_USERNAME env var with existing session file
    if (process.env.INSTA_USERNAME) {
        return ["--login", process.env.INSTA_USERNAME];
    }

    return [];
}

/**
 * Convert a Netscape cookies.txt file into an instaloader-compatible session file.
 * Uses a small inline Python script to:
 *   1. Parse the cookies.txt for instagram.com cookies
 *   2. Build a Python requests session with those cookies
 *   3. Pickle (serialize) it as an instaloader session file
 * Returns the path to the session file, or null if conversion fails.
 */
function createSessionFromCookies(): string | null {
    const { resolve } = require("path");
    const tempDir = process.env.TEMP || process.env.TMP || "/tmp";
    const sessionOutPath = join(tempDir, "instaloader_cookie_session");

    // If we already created a session recently and it exists, reuse it
    if (existsSync(sessionOutPath)) {
        try {
            const stat = require("fs").statSync(sessionOutPath);
            const ageMs = Date.now() - stat.mtimeMs;
            // Reuse if less than 10 minutes old
            if (ageMs < 600_000) return sessionOutPath;
        } catch { /* recreate */ }
    }

    // Find cookies.txt source
    let cookiesPath: string | null = null;

    if (process.env.YTDLP_COOKIES) {
        try {
            const tempCookieFile = join(tempDir, "cookies_for_insta.txt");
            writeFileSync(
                tempCookieFile,
                Buffer.from(process.env.YTDLP_COOKIES, "base64").toString("utf8")
            );
            cookiesPath = tempCookieFile;
        } catch (err) {
            console.error("[instaloader] Failed to decode YTDLP_COOKIES:", err);
        }
    }

    if (!cookiesPath) {
        const projectCookies = resolve(process.cwd(), "cookies.txt");
        if (existsSync(projectCookies)) {
            cookiesPath = projectCookies;
        }
    }

    if (!cookiesPath) return null;

    // Python script that converts cookies.txt → instaloader session
    const pythonScript = `
import sys, pickle, os
try:
    import requests
    from http.cookiejar import MozillaCookieJar
except ImportError:
    sys.exit(1)

cookies_path = sys.argv[1]
output_path = sys.argv[2]

jar = MozillaCookieJar(cookies_path)
try:
    jar.load(ignore_discard=True, ignore_expires=True)
except Exception as e:
    print(f"Failed to load cookies: {e}", file=sys.stderr)
    sys.exit(1)

# Filter to Instagram cookies only
insta_cookies = {}
for cookie in jar:
    if 'instagram.com' in cookie.domain or '.instagram.com' in cookie.domain:
        insta_cookies[cookie.name] = cookie.value

if not insta_cookies:
    print("No Instagram cookies found in cookies.txt", file=sys.stderr)
    sys.exit(1)

# Build a requests session with these cookies
session = requests.Session()
for name, value in insta_cookies.items():
    session.cookies.set(name, value, domain='.instagram.com')

# Set a realistic User-Agent
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'X-IG-App-ID': '936619743392459',
})

# Save as pickle (instaloader session format)
with open(output_path, 'wb') as f:
    pickle.dump(session, f)

print(f"Session created with {len(insta_cookies)} Instagram cookies", file=sys.stderr)
`;

    try {
        const scriptPath = join(tempDir, "convert_cookies_to_session.py");
        writeFileSync(scriptPath, pythonScript);

        execSync(
            `python3 "${scriptPath}" "${cookiesPath}" "${sessionOutPath}"`,
            { stdio: "pipe", timeout: 10000 }
        );

        if (existsSync(sessionOutPath)) {
            console.log("[instaloader] Created session from cookies.txt");
            return sessionOutPath;
        }
    } catch (err) {
        // Try 'python' command on Windows
        try {
            const scriptPath = join(tempDir, "convert_cookies_to_session.py");
            execSync(
                `python "${scriptPath}" "${cookiesPath}" "${sessionOutPath}"`,
                { stdio: "pipe", timeout: 10000 }
            );
            if (existsSync(sessionOutPath)) {
                console.log("[instaloader] Created session from cookies.txt (python)");
                return sessionOutPath;
            }
        } catch {
            console.error("[instaloader] Failed to convert cookies.txt to session:", err);
        }
    }

    return null;
}

/**
 * Analyze an Instagram URL using instaloader.
 * Instaloader excels at extracting photos and carousels (slideshows).
 * Now also handles stories with proper session/cookie support.
 */
export async function analyzeWithInstaloader(
    url: string,
    platform: Platform,
): Promise<MediaInfo> {
    const isStory = /instagram\.com\/stories\//i.test(url);

    if (isStory) {
        return analyzeStoryWithInstaloader(url, platform);
    }

    const shortcode = extractShortcode(url);
    if (!shortcode) {
        throw new Error("Could not extract Instagram shortcode from URL");
    }

    return new Promise((resolve, reject) => {
        const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
        const outDir = join(tmpDir, `mediagrab_insta_analyze_${shortcode}`);

        // Clean up any previous attempt
        if (existsSync(outDir)) {
            try {
                const { rmSync } = require("fs");
                rmSync(outDir, { recursive: true, force: true });
            } catch { /* ignore */ }
        }
        mkdirSync(outDir, { recursive: true });

        // instaloader downloads the post to a directory
        const args = [
            "--no-video-thumbnails",
            "--no-captions",
            "--no-metadata-json",
            "--no-compress-json",
            "--dirname-pattern", outDir,
            "--filename-pattern", "{shortcode}_{mediaid}",
            ...getSessionArgs(),
            "--", `-${shortcode}`,  // the -- prefix downloads a single post by shortcode
        ];

        const proc = spawn("instaloader", args);
        let stderr = "";

        proc.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        proc.stdout.on("data", (chunk) => {
            console.log("instaloader:", chunk.toString().trim());
        });

        proc.on("close", (code) => {
            console.log("instaloader exit code:", code, "stderr:", stderr);

            // Scan downloaded files
            const items: MediaItem[] = [];
            let uploader = "Unknown";

            try {
                if (existsSync(outDir)) {
                    const files = readdirSync(outDir).filter((f) => {
                        const ext = extname(f).toLowerCase();
                        return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov"].includes(ext);
                    }).sort();

                    for (let i = 0; i < files.length; i++) {
                        const filePath = join(outDir, files[i]);
                        const ext = extname(files[i]).toLowerCase();
                        const videoExts = [".mp4", ".webm", ".mov"];
                        const isVideo = videoExts.includes(ext);

                        // Generate thumbnail
                        let thumbnail = "";
                        if (!isVideo) {
                            try {
                                const imgBuffer = readFileSync(filePath);
                                const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
                                thumbnail = `data:${mimeType};base64,${imgBuffer.toString("base64")}`;
                            } catch {
                                thumbnail = "";
                            }
                        } else {
                            const thumbPath = `${filePath}.thumb.jpg`;
                            try {
                                execSync(
                                    `ffmpeg -y -i "${filePath}" -ss 00:00:01 -vframes 1 -vf scale=480:-1 -q:v 5 "${thumbPath}"`,
                                    { stdio: "pipe", timeout: 15000 }
                                );
                                if (existsSync(thumbPath)) {
                                    const imgBuffer = readFileSync(thumbPath);
                                    thumbnail = `data:image/jpeg;base64,${imgBuffer.toString("base64")}`;
                                    try { unlinkSync(thumbPath); } catch { /* ignore */ }
                                }
                            } catch {
                                try { if (existsSync(thumbPath)) unlinkSync(thumbPath); } catch { /* ignore */ }
                            }
                        }

                        const videoServeUrl = `/api/serve-file?path=${encodeURIComponent(filePath)}`;

                        items.push({
                            type: isVideo ? "video" : "photo",
                            title: `Item ${i + 1}`,
                            thumbnail,
                            duration: null,
                            formats: isVideo
                                ? [{
                                    format_id: "best",
                                    quality: "Best",
                                    ext: ext.slice(1),
                                    filesize: null,
                                    resolution: null,
                                    vcodec: null,
                                    acodec: null,
                                    height: null,
                                    fps: null,
                                    url: videoServeUrl,
                                    has_audio: true,
                                }]
                                : [],
                            direct_url: isVideo ? videoServeUrl : thumbnail,
                            audio_url: null,
                            index: i,
                        });
                    }

                    // Try to extract username from stderr output
                    const userMatch = stderr.match(/(?:@|from\s+)(\w+)/i);
                    if (userMatch) uploader = userMatch[1];
                }
            } catch (err) {
                console.error("Error scanning instaloader output:", err);
            }

            if (items.length === 0 && code !== 0) {
                reject(new Error(stderr || `instaloader exited with code ${code}`));
                return;
            }

            resolve({
                platform,
                title: `Instagram Post ${shortcode}`,
                uploader,
                items,
                original_url: url,
            });
        });

        proc.on("error", (err) => {
            reject(new Error(`instaloader not found: ${err.message}. Install it with: pip install instaloader`));
        });

        setTimeout(() => {
            proc.kill();
            reject(new Error("instaloader timed out"));
        }, 60000);
    });
}

/**
 * Analyze Instagram stories using instaloader.
 * Stories require authentication — we use session file or login credentials.
 */
async function analyzeStoryWithInstaloader(
    url: string,
    platform: Platform,
): Promise<MediaInfo> {
    const storyInfo = extractStoryInfo(url);
    if (!storyInfo) {
        throw new Error("Could not extract story info from URL");
    }

    const { username, storyId } = storyInfo;
    const sessionArgs = getSessionArgs();

    if (sessionArgs.length === 0) {
        throw new Error(
            "Instagram Stories require authentication. " +
            "Set INSTA_SESSION (base64 session file) or INSTA_USERNAME environment variable."
        );
    }

    return new Promise((resolve, reject) => {
        const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
        const outDir = join(tmpDir, `mediagrab_insta_story_${username}_${Date.now()}`);

        // Clean up any previous attempt
        if (existsSync(outDir)) {
            try {
                const { rmSync } = require("fs");
                rmSync(outDir, { recursive: true, force: true });
            } catch { /* ignore */ }
        }
        mkdirSync(outDir, { recursive: true });

        // instaloader command for stories:
        // --stories: download stories
        // --no-posts: don't download regular posts
        // --no-profile-pic: skip profile picture
        const args = [
            "--stories",
            "--no-posts",
            "--no-profile-pic",
            "--no-captions",
            "--no-metadata-json",
            "--no-compress-json",
            "--dirname-pattern", outDir,
            "--filename-pattern", "{date_utc:%Y%m%d_%H%M%S}_{mediaid}",
            ...sessionArgs,
            username,
        ];

        // If we have INSTA_PASSWORD and are using --login, pipe password
        const spawnOpts: any = {};
        if (process.env.INSTA_PASSWORD && sessionArgs.includes("--login")) {
            spawnOpts.env = { ...process.env };
        }

        console.log(`[instaloader] Fetching stories for @${username}${storyId ? ` (story ${storyId})` : ""}`);
        const proc = spawn("instaloader", args, spawnOpts);
        let stderr = "";
        let stdout = "";

        proc.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        proc.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
            console.log("instaloader story:", chunk.toString().trim());
        });

        // If using --login with password, send it via stdin
        if (process.env.INSTA_PASSWORD && sessionArgs.includes("--login")) {
            proc.stdin.write(process.env.INSTA_PASSWORD + "\n");
            proc.stdin.end();
        }

        proc.on("close", (code) => {
            console.log("instaloader story exit code:", code, "stderr:", stderr.slice(0, 500));

            // Scan downloaded files
            const items: MediaItem[] = [];

            try {
                if (existsSync(outDir)) {
                    const allFiles = readdirSync(outDir).filter((f) => {
                        const ext = extname(f).toLowerCase();
                        return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov"].includes(ext);
                    }).sort();

                    // If a specific storyId was provided, try to find that specific story
                    // Otherwise, return all stories for the user
                    let files = allFiles;
                    if (storyId && allFiles.length > 1) {
                        const matching = allFiles.filter(f => f.includes(storyId));
                        if (matching.length > 0) files = matching;
                    }

                    for (let i = 0; i < files.length; i++) {
                        const filePath = join(outDir, files[i]);
                        const ext = extname(files[i]).toLowerCase();
                        const videoExts = [".mp4", ".webm", ".mov"];
                        const isVideo = videoExts.includes(ext);

                        // Generate thumbnail
                        let thumbnail = "";
                        if (!isVideo) {
                            try {
                                const imgBuffer = readFileSync(filePath);
                                const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
                                thumbnail = `data:${mimeType};base64,${imgBuffer.toString("base64")}`;
                            } catch {
                                thumbnail = "";
                            }
                        } else {
                            const thumbPath = `${filePath}.thumb.jpg`;
                            try {
                                execSync(
                                    `ffmpeg -y -i "${filePath}" -ss 00:00:00.5 -vframes 1 -vf scale=480:-1 -q:v 5 "${thumbPath}"`,
                                    { stdio: "pipe", timeout: 15000 }
                                );
                                if (existsSync(thumbPath)) {
                                    const imgBuffer = readFileSync(thumbPath);
                                    thumbnail = `data:image/jpeg;base64,${imgBuffer.toString("base64")}`;
                                    try { unlinkSync(thumbPath); } catch { /* ignore */ }
                                }
                            } catch {
                                try { if (existsSync(thumbPath)) unlinkSync(thumbPath); } catch { /* ignore */ }
                            }
                        }

                        const videoServeUrl = `/api/serve-file?path=${encodeURIComponent(filePath)}`;

                        items.push({
                            type: isVideo ? "video" : "photo",
                            title: `Story ${i + 1}`,
                            thumbnail,
                            duration: null,
                            formats: isVideo
                                ? [{
                                    format_id: "best",
                                    quality: "Best",
                                    ext: ext.slice(1),
                                    filesize: null,
                                    resolution: null,
                                    vcodec: null,
                                    acodec: null,
                                    height: null,
                                    fps: null,
                                    url: videoServeUrl,
                                    has_audio: true,
                                }]
                                : [],
                            direct_url: isVideo ? videoServeUrl : thumbnail,
                            audio_url: null,
                            index: i,
                        });
                    }
                }
            } catch (err) {
                console.error("Error scanning instaloader story output:", err);
            }

            if (items.length === 0 && code !== 0) {
                // Parse common instaloader errors
                if (stderr.includes("login") || stderr.includes("Login") || stderr.includes("session")) {
                    reject(new Error(
                        "Instagram Stories require authentication. " +
                        "Please set INSTA_SESSION or INSTA_USERNAME environment variables with valid Instagram credentials."
                    ));
                } else if (stderr.includes("does not exist") || stderr.includes("not found")) {
                    reject(new Error(`Instagram user @${username} not found or has no active stories.`));
                } else {
                    reject(new Error(stderr || `instaloader story download failed (code ${code})`));
                }
                return;
            }

            resolve({
                platform,
                title: `Stories by @${username}`,
                uploader: username,
                items,
                original_url: url,
            });
        });

        proc.on("error", (err) => {
            reject(new Error(`instaloader not found: ${err.message}. Install it with: pip install instaloader`));
        });

        setTimeout(() => {
            proc.kill();
            reject(new Error("instaloader story download timed out"));
        }, 90000);  // Stories can take longer to download
    });
}

/**
 * Download media from an Instagram post using instaloader.
 */
export function downloadWithInstaloader(
    url: string,
    downloadId: string,
    itemIndex?: number,
): Promise<{ filePath: string; filename: string; isZip?: boolean }> {
    const shortcode = extractShortcode(url);
    if (!shortcode) {
        return Promise.reject(new Error("Could not extract Instagram shortcode from URL"));
    }

    return new Promise((resolve, reject) => {
        const tmpDir = process.env.TEMP || process.env.TMP || "/tmp";
        const outDir = join(tmpDir, `mediagrab_insta_${downloadId}`);

        mkdirSync(outDir, { recursive: true });

        const args = [
            "--no-video-thumbnails",
            "--no-captions",
            "--no-metadata-json",
            "--no-compress-json",
            "--dirname-pattern", outDir,
            "--filename-pattern", "{shortcode}_{mediaid}",
            ...getSessionArgs(),
            "--", `-${shortcode}`,
        ];

        const proc = spawn("instaloader", args);

        setProgress(downloadId, { percent: 10, speed: "", eta: "", status: "downloading" });

        proc.stdout.on("data", (chunk) => {
            const line = chunk.toString();
            console.log("instaloader download:", line.trim());
            setProgress(downloadId, {
                percent: Math.min(80, 10 + Math.random() * 30),
                speed: "",
                eta: "",
                status: "downloading",
            });
        });

        proc.stderr.on("data", (chunk) => {
            console.error("instaloader stderr:", chunk.toString());
        });

        proc.on("close", (code) => {
            if (code !== 0) {
                setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
                reject(new Error(`instaloader exited with code ${code}`));
                return;
            }

            // Find downloaded files
            let files: string[] = [];
            try {
                if (existsSync(outDir)) {
                    files = readdirSync(outDir)
                        .filter((f) => {
                            const ext = extname(f).toLowerCase();
                            return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov"].includes(ext);
                        })
                        .sort()
                        .map((f) => join(outDir, f));
                }
            } catch { /* ignore */ }

            if (files.length === 0) {
                setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
                reject(new Error("No files were downloaded by instaloader"));
                return;
            }

            setProgress(downloadId, { percent: 100, speed: "", eta: "", status: "complete" });

            if (itemIndex !== undefined && itemIndex < files.length) {
                resolve({
                    filePath: files[itemIndex],
                    filename: basename(files[itemIndex]),
                });
                return;
            }

            if (files.length === 1) {
                resolve({
                    filePath: files[0],
                    filename: basename(files[0]),
                });
                return;
            }

            resolve({
                filePath: outDir,
                filename: `mediagrab_insta_${downloadId}`,
                isZip: true,
            });
        });

        proc.on("error", (err) => {
            setProgress(downloadId, { percent: 0, speed: "", eta: "", status: "error" });
            reject(new Error(`Failed to run instaloader: ${err.message}`));
        });

        setTimeout(() => {
            proc.kill();
            reject(new Error("instaloader download timed out"));
        }, 300000);
    });
}
