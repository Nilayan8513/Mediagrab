// Test the actual scraper directly via the Next.js API
const response = await fetch('http://localhost:3000/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.facebook.com/share/p/1X44iaQTzF/' }),
});

const data = await response.json();
console.log('Status:', response.status);
console.log('Response:', JSON.stringify(data, null, 2));
if (data.items) {
    console.log(`\nTotal items: ${data.items.length}`);
    data.items.forEach((item, i) => {
        console.log(`  Item ${i + 1}: type=${item.type}, title=${item.title}`);
        console.log(`    thumbnail: ${(item.thumbnail || '').substring(0, 80)}`);
        console.log(`    direct_url: ${(item.direct_url || '').substring(0, 80)}`);
    });
}
