/**
 * Assemble build/penguinmod from a folder of PenguinMod extension files and a
 * folder of their thumbnails.
 *
 *     node scripts/flipwarp-bundle-penguinmod.js <extensions dir> <images dir>
 *
 * Both are what the checker page downloads. This exists because `npm run
 * build` empties build/, so the bundled extensions have to be put back after
 * every build, and doing it by hand is how a release goes out with a list
 * that names no pictures.
 *
 * An extension whose file is not in the extensions folder is left out of the
 * list rather than listed and broken — that is how Pen+ is excluded, since
 * Windows Defender objects to that one file and stops the whole folder from
 * unpacking.
 */
const fs = require('fs');
const path = require('path');

const GALLERY = path.join(__dirname, 'penguinmod-gallery.json');
const OUT = path.join(__dirname, '..', 'build', 'penguinmod');

const copyInto = (fromDir, toDir) => {
    fs.mkdirSync(toDir, {recursive: true});
    for (const entry of fs.readdirSync(fromDir, {withFileTypes: true})) {
        const from = path.join(fromDir, entry.name);
        const to = path.join(toDir, entry.name);
        if (entry.isDirectory()) copyInto(from, to);
        else fs.copyFileSync(from, to);
    }
};

const main = () => {
    const [extensionsDir, imagesDir] = process.argv.slice(2);
    if (!extensionsDir) {
        console.error('usage: node scripts/flipwarp-bundle-penguinmod.js <extensions dir> [images dir]');
        process.exit(1);
    }

    fs.rmSync(OUT, {recursive: true, force: true});
    copyInto(extensionsDir, OUT);
    if (imagesDir && fs.existsSync(imagesDir)) copyInto(imagesDir, path.join(OUT, 'images'));

    const gallery = JSON.parse(fs.readFileSync(GALLERY, 'utf8'));
    const manifest = [];
    const skipped = [];
    for (const entry of gallery) {
        if (!fs.existsSync(path.join(OUT, entry.code))) {
            skipped.push(entry.name);
            continue;
        }
        const image = entry.banner && fs.existsSync(path.join(OUT, 'images', entry.banner)) ?
            `images/${entry.banner}` : null;
        manifest.push({
            name: entry.name,
            description: entry.description || '',
            code: entry.code,
            creator: entry.creator || '',
            image,
            tags: entry.tags || []
        });
    }

    fs.writeFileSync(path.join(OUT, 'extensions.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const credits = [
        'Extensions bundled from PenguinMod, used under the MIT licence.',
        'Source: https://github.com/PenguinMod/PenguinMod-ExtensionsGallery',
        'Each extension belongs to its author, credited below.',
        ''
    ];
    for (const entry of manifest) credits.push(`${entry.name} — ${entry.creator} — ${entry.code}`);
    if (skipped.length) {
        credits.push('', 'Not included in this copy:', ...skipped.map(name => `  ${name}`));
    }
    fs.writeFileSync(path.join(OUT, 'CREDITS.txt'), `${credits.join('\n')}\n`);

    const withPicture = manifest.filter(e => e.image).length;
    console.log(`${manifest.length} listed, ${withPicture} with a picture` +
        (skipped.length ? `, left out: ${skipped.join(', ')}` : ''));
};

main();
