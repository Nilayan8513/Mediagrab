import { readFileSync } from "fs";
const html = readFileSync("test_fb_full.html", "utf8");

const urls = new Set();
// Search for anything that looks like a URL ending in .jpg, .png, or .webp
for (const match of html.matchAll(/(https?:\/\/[a-zA-Z0-9.\-/%_]+\.(?:jpg|jpeg|png|webp)[^"'\s\\]*)/gi)) {
    urls.add(match[1]);
}

// Search for anything starting with https:// and containing image/photo logic
for (const match of html.matchAll(/(https?:\/\/[a-zA-Z0-9.\-/%_&?=]*(?:photo|image|fbcdn)[^"'\s\\]*)/gi)) {
    urls.add(match[1]);
}

const filtered = [...urls]
    .filter(u => !u.includes("static.xx") && !u.includes("rsrc") && !u.includes("emoji"))
    .map(u => u.replace(/\\\//g, '/').replace(/\\u0025/g, '%'))
    .sort();

console.log(`Found ${filtered.length} candidate URLs`);
for (let i = 0; i < Math.min(filtered.length, 20); i++) {
    console.log(`  ${filtered[i].substring(0, 150)}`);
}
