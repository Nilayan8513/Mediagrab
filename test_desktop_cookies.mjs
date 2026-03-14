import { readFileSync } from "fs";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const URL = "https://www.facebook.com/share/p/1X44iaQTzF/";

const content = readFileSync("cookies.txt", "utf8");
const cookies = [];
for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length >= 7 && parts[0].includes("facebook.com")) {
        cookies.push(`${parts[5]}=${parts[6].trim()}`);
    }
}
const cookieStr = cookies.join("; ");

async function run() {
    const headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": cookieStr
    };

    console.log("Fetching desktop...");
    const res = await fetch(URL, { headers, redirect: "follow" });
    const html = await res.text();
    console.log(`Status: ${res.status}, Size: ${html.length}, URL: ${res.url}`);

    // Test if there are scontent URLs
    const scontent = [...html.matchAll(/"(https?[^"]*scontent[^"]*)"/gi)];
    console.log(`scontent matches: ${scontent.length}`);
}

run();
