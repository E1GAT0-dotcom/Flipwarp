/**
 * Download PenguinMod's extension gallery into two folders, ready for
 * scripts/flipwarp-bundle-penguinmod.js.
 *
 *     node scripts/flipwarp-fetch-penguinmod.js <extensions dir> <images dir>
 *
 * This is what the build does instead of asking you to run the checker page
 * and unzip the result by hand. It happens once per build, not once per
 * visitor: PenguinMod's server serves this a few times a month rather than
 * every time somebody opens the editor.
 *
 * The list of what to fetch is scripts/penguinmod-gallery.json, which is in
 * this repository, so a build fetches exactly what is written down there and
 * a new extension appearing in their gallery cannot change what this site
 * ships without somebody updating that file.
 */
const fs = require('fs');
const path = require('path');

const GALLERY = path.join(__dirname, 'penguinmod-gallery.json');
const CODE_BASE = 'https://extensions.penguinmod.com/extensions/';
const IMAGE_BASE = 'https://extensions.penguinmod.com/images/';

const save = async (url, file) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
};

const main = async () => {
    const [extensionsDir, imagesDir] = process.argv.slice(2);
    if (!extensionsDir || !imagesDir) {
        console.error('usage: node scripts/flipwarp-fetch-penguinmod.js <extensions dir> <images dir>');
        process.exit(1);
    }

    const gallery = JSON.parse(fs.readFileSync(GALLERY, 'utf8'));
    let code = 0;
    let pictures = 0;
    const missing = [];

    for (const entry of gallery) {
        try {
            await save(CODE_BASE + entry.code, path.join(extensionsDir, entry.code));
            code++;
        } catch (e) {
            // One extension moving or being withdrawn must not fail the whole
            // build; it is simply not in this deploy, and the bundler leaves
            // it out of the list rather than listing something that is not
            // there.
            missing.push(`${entry.name} (${e.message})`);
            continue;
        }
        if (!entry.banner) continue;
        try {
            await save(IMAGE_BASE + entry.banner, path.join(imagesDir, entry.banner));
            pictures++;
        } catch (e) {
            // A missing picture costs a thumbnail, nothing more.
        }
    }

    console.log(`fetched ${code} extensions and ${pictures} thumbnails`);
    if (missing.length) console.log(`could not fetch: ${missing.join(', ')}`);
};

main().catch(err => {
    console.error(err);
    process.exit(1);
});
