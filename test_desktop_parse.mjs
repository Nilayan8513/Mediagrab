import { readFileSync } from "fs";

function decodeHTMLEntities(str) {
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/");
}

function decodeEscapedUrl(raw) {
    return raw
        .replace(/\\u0025/g, "%")
        .replace(/\\u003[cC]/g, "<")
        .replace(/\\u003[eE]/g, ">")
        .replace(/\\u0026/g, "&")
        .replace(/\\\//g, "/")
        .replace(/\\"/g, '"')
        .replace(/%25/g, "%");
}

function cleanCdnUrl(url) {
    let cleaned = url;
    for (let i = 0; i < 5; i++) {
        const next = decodeHTMLEntities(cleaned);
        if (next === cleaned) break;
        cleaned = next;
    }
    cleaned = cleaned.replace(/\\\//g, "/");
    return cleaned;
}

function isHighResFacebookImage(url) {
    if (url.includes("emoji") || url.includes("reaction")) return false;
    if (url.includes("/rsrc.php/")) return false;
    if (url.includes("static.xx.fbcdn.net/rsrc")) return false;

    const fbCdnPatterns = [
        /scontent[^.]*\.fbcdn\.net/i,
        /scontent[^.]*\.xx\.fbcdn\.net/i,
        /scontent[^.]*\.cdninstagram\.com/i,
        /external[^.]*\.fbcdn\.net/i,
        /z-m-scontent/i,
    ];
    return fbCdnPatterns.some((p) => p.test(url));
}

const html = readFileSync("d:/Mediagrab/test_fb_full.html", "utf8");

const images = [];
const seen = new Set();
let match;

// Pattern 1
const uriPattern = new RegExp(
    '"(?:uri|url|src|image_uri|full_image|photo_image|viewer_image|image\\.uri|large_share_image)"' +
    '\\s*:\\s*"(https?[^"]+(?:scontent|fbcdn)[^"]+)"',
    "gi"
);
while ((match = uriPattern.exec(html)) !== null) {
    const decoded = cleanCdnUrl(decodeEscapedUrl(match[1]));
    if (isHighResFacebookImage(decoded) && !seen.has(decoded)) {
        seen.add(decoded);
        images.push(decoded);
    }
}
console.log(`Pattern 1 found: ${images.length}`);

// Pattern 2
const scontentBroadPattern = new RegExp(
    '"(https?[^"]*(?:scontent|fbcdn\\.net)[^"]*?)"',
    "gi"
);
const pattern2Images = [];
while ((match = scontentBroadPattern.exec(html)) !== null) {
    const decoded = cleanCdnUrl(decodeEscapedUrl(match[1]));
    if (isHighResFacebookImage(decoded) && !seen.has(decoded)) {
        seen.add(decoded);
        pattern2Images.push(decoded);
        images.push(decoded);
    }
}
console.log(`Pattern 2 found: ${pattern2Images.length}`);
console.log(`Total images: ${images.length}`);

// Print unique images
// Filter like the logic does:
const filtered = images.filter((img) => {
    if (!img.includes("fbcdn.net") && !img.includes("facebook.com")) return false;
    const dimMatch = img.match(/(?:_|\/|=)(\d+)x(\d+)/);
    if (dimMatch) {
        const w = parseInt(dimMatch[1], 10);
        const h = parseInt(dimMatch[2], 10);
        if (w < 200 && h < 200) return false;
    }
    return true;
});

// Deduplicate
function deduplicateImages(urls) {
    const groups = new Map();
    for (const url of urls) {
        try {
            const parsed = new URL(url);
            const pathParts = parsed.pathname.split("/");
            const filename = pathParts[pathParts.length - 1] || "";
            const baseKey = filename.replace(/_[a-z](?=\.)/i, "");
            if (!groups.has(baseKey)) groups.set(baseKey, []);
            groups.get(baseKey).push(url);
        } catch {
            groups.set(url, [url]);
        }
    }
    const result = [];
    for (const group of groups.values()) {
        const best = group.sort((a, b) => {
            const scoreA = a.includes("_o.") ? 3 : a.includes("_n.") ? 2 : 1;
            const scoreB = b.includes("_o.") ? 3 : b.includes("_n.") ? 2 : 1;
            if (scoreA !== scoreB) return scoreB - scoreA;
            return b.length - a.length;
        })[0];
        result.push(best);
    }
    return result;
}

const unique = deduplicateImages(filtered);
console.log(`Final unique images: ${unique.length}`);
for (let i = 0; i < Math.min(unique.length, 5); i++) {
    console.log(`  ${unique[i].substring(0, 100)}...`);
}
