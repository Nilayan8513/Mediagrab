import { scrapeFacebookPhotos } from './src/lib/facebook-photo';

const URL = 'https://www.facebook.com/share/p/1X44iaQTzF/';
async function run() {
    try {
        const info = await scrapeFacebookPhotos(URL);
        console.log(JSON.stringify(info, null, 2));
    } catch (e) {
        console.error(e);
    }
}
run();
