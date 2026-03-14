// Quick debug script to test Facebook scraping
import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve } from "path";

const URL = "https://www.facebook.com/share/p/1X44iaQTzF/";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const MBASIC_USER_AGENT = "Mozilla/5.0 (Linux; Android 4.4.2; Nexus 5 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2490.76 Mobile Safari/537.36";

// Load cookies
function getFacebookCookies() {
    const cookiesFile = resolve(process.cwd(), "cookies.txt");
    if (existsSync(cookiesFile)) {
        const content = readFileSync(cookiesFile, "utf8");
        const cookies = [];
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const parts = trimmed.split("\t");
            if (parts.length >= 7 && parts[0].includes("facebook.com")) {
                cookies.push(`${parts[5]}=${parts[6]}`);
            }
        }
        return cookies.join("; ");
    }
    return "";
}

const cookies = getFacebookCookies();
console.log(`Cookies: ${cookies ? `YES (${cookies.length} chars)` : "NONE"}`);

// Test mbasic
async function testMbasic() {
    const mbasicUrl = URL.replace(/https?:\/\/(www\.)?facebook\.com/, "https://mbasic.facebook.com");
    console.log(`\n=== MBASIC: ${mbasicUrl} ===`);

    const headers = {
        "User-Agent": MBASIC_USER_AGENT,
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
    };
    if (cookies) headers["Cookie"] = cookies;

    const res = await fetch(mbasicUrl, { headers, redirect: "follow" });
    const html = await res.text();
    console.log(`Status: ${res.status}, Size: ${html.length} bytes, Final URL: ${res.url}`);

    // Save HTML for inspection
    writeFileSync("d:/Mediagrab/fb_mbasic.html", html);
    console.log("Saved to d:/Mediagrab/fb_mbasic.html");

    // Check login indicators
    console.log(`Has login_form: ${html.includes("login_form")}`);
    console.log(`Has "You must log in": ${html.includes("You must log in")}`);
    console.log(`Has /login/: ${html.includes("/login/")}`);
    console.log(`Has og:image: ${html.includes("og:image")}`);
    console.log(`Has "photo": ${html.includes("photo")}`);
    console.log(`Has scontent: ${html.includes("scontent")}`);
    console.log(`Has fbcdn: ${html.includes("fbcdn")}`);
    console.log(`Has img tag: ${html.includes("<img")}`);
    console.log(`Has story_body: ${html.includes("story_body")}`);

    // Find photo links
    const photoPhpLinks = [...html.matchAll(/href="(\/photo\.php\?[^"]+)"/gi)];
    console.log(`\n/photo.php links: ${photoPhpLinks.length}`);
    photoPhpLinks.forEach((m, i) => console.log(`  ${i + 1}: ${m[1].substring(0, 100)}`));

    const photosLinks = [...html.matchAll(/href="(\/[^"]*\/photos\/[^"]+)"/gi)];
    console.log(`/photos/ links: ${photosLinks.length}`);
    photosLinks.forEach((m, i) => console.log(`  ${i + 1}: ${m[1].substring(0, 100)}`));

    const photoSlashLinks = [...html.matchAll(/href="(\/photo\/[^"]+)"/gi)];
    console.log(`/photo/ links: ${photoSlashLinks.length}`);
    photoSlashLinks.forEach((m, i) => console.log(`  ${i + 1}: ${m[1].substring(0, 100)}`));

    // Find all scontent URLs
    const scontentUrls = [...html.matchAll(/scontent[^"'\s<>]*/gi)];
    console.log(`\nscontent URL fragments: ${scontentUrls.length}`);
    const unique = [...new Set(scontentUrls.map(m => m[0].substring(0, 80)))];
    unique.forEach((u, i) => console.log(`  ${i + 1}: ${u}...`));

    // Find ALL href values that contain photo-related content
    const allPhotoHrefs = [...html.matchAll(/href="([^"]*(?:photo|fbid|pcb)[^"]*)"/gi)];
    console.log(`\nAll photo-related hrefs: ${allPhotoHrefs.length}`);
    allPhotoHrefs.forEach((m, i) => console.log(`  ${i + 1}: ${m[1].substring(0, 120)}`));
}

// Test desktop
async function testDesktop() {
    console.log(`\n=== DESKTOP: ${URL} ===`);

    const headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
    };
    if (cookies) headers["Cookie"] = cookies;

    const res = await fetch(URL, { headers, redirect: "follow" });
    const html = await res.text();
    console.log(`Status: ${res.status}, Size: ${html.length} bytes`);

    writeFileSync("d:/Mediagrab/fb_desktop.html", html);
    console.log("Saved to d:/Mediagrab/fb_desktop.html");

    // Count scontent URLs
    const scontentAll = [...html.matchAll(/"(https?[^"]*scontent[^"]*)"/gi)];
    console.log(`\nAll scontent URLs in quotes: ${scontentAll.length}`);

    // Deduplicate by filename
    const byFile = new Map();
    for (const m of scontentAll) {
        try {
            const url = m[1].replace(/\\\//g, "/");
            const pathname = new globalThis.URL(url).pathname;
            const filename = pathname.split("/").pop();
            if (!byFile.has(filename)) byFile.set(filename, []);
            byFile.get(filename).push(url.substring(0, 100));
        } catch { }
    }
    console.log(`Unique filenames: ${byFile.size}`);
    for (const [file, urls] of byFile) {
        if (!file.includes("rsrc") && !file.includes("emoji")) {
            console.log(`  ${file}: ${urls.length} occurrences`);
        }
    }

    // OG images
    const ogImages = [...html.matchAll(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/gi)];
    const ogImagesRev = [...html.matchAll(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/gi)];
    console.log(`\nOG images: ${ogImages.length + ogImagesRev.length}`);
}

await testMbasic();
await testDesktop();
