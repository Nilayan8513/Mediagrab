// Quick test to count images from desktop Facebook
const res = await fetch('https://www.facebook.com/share/p/1X44iaQTzF/', {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
});

const html = await res.text();
console.log(`Status: ${res.status}, Size: ${html.length}, Final URL: ${res.url}`);
console.log(`login_form: ${html.includes('login_form')}`);

// Count scontent references
const scontentCount = (html.match(/scontent/gi) || []).length;
console.log(`scontent occurrences: ${scontentCount}`);

// Extract all unique scontent URLs from JSON data
const allUrls = [...html.matchAll(/"(https?:[^"]*scontent[^"]*)"/gi)];
console.log(`\nAll scontent URLs in double quotes: ${allUrls.length}`);

// Decode and deduplicate
const decoded = new Set();
for (const m of allUrls) {
    let url = m[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
    // Skip tiny images
    if (url.includes('/rsrc.php/') || url.includes('emoji') || url.includes('static.xx')) continue;
    try {
        const pathname = new URL(url).pathname;
        const filename = pathname.split('/').pop();
        decoded.add(filename);
    } catch { }
}
console.log(`\nUnique image filenames (after filtering): ${decoded.size}`);
for (const f of decoded) {
    console.log(`  ${f}`);
}

// Also check OG images
const ogPattern1 = [...html.matchAll(/<meta[^>]+og:image[^>]+content=["']([^"']+)["']/gi)];
const ogPattern2 = [...html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+og:image/gi)];
console.log(`\nOG images: ${ogPattern1.length + ogPattern2.length}`);
for (const m of [...ogPattern1, ...ogPattern2]) {
    console.log(`  ${m[1].substring(0, 120)}`);
}

// Check what our isLoginPage would say
const hasLoginForm = html.includes('login_form');
const hasYouMustLogIn = html.includes('You must log in');
const hasLogin = html.includes('/login/');
const hasOgImage = html.includes('og:image');
const hasPhoto = html.includes('photo');
const hasScontent = html.includes('scontent');
const hasFbcdn = html.includes('fbcdn');
const hasImg = html.includes('<img');
console.log(`\nLogin detection inputs:`);
console.log(`  login_form: ${hasLoginForm}`);
console.log(`  You must log in: ${hasYouMustLogIn}`);
console.log(`  /login/: ${hasLogin}`);
console.log(`  og:image: ${hasOgImage}`);
console.log(`  photo: ${hasPhoto}`);
console.log(`  scontent: ${hasScontent}`);
console.log(`  fbcdn: ${hasFbcdn}`);
console.log(`  <img: ${hasImg}`);
console.log(`  length: ${html.length}`);
