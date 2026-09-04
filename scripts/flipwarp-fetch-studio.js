/**
 * Fetch a Scratch studio's project list at build time.
 *
 * The featured projects on the front page used to be read from TurboWarp's
 * trampoline, which exists because Scratch's API refuses to answer another
 * website directly. That worked, but it put a server we do not control
 * between this site and its own content — and when its cache holds an empty
 * answer, as it did for this studio, there is nothing to be done from here
 * but wait, and the front page shows nothing.
 *
 * A build runs on a server, where none of that applies: it can ask Scratch
 * directly. So the list is fetched once, written into the site, and served
 * from the same place as everything else. It also means the front page costs
 * TurboWarp nothing, which is the same reason the PenguinMod extensions are
 * bundled rather than fetched.
 *
 * The trade is that the list is only as fresh as the last build. Adding a
 * project to the studio shows up the next time the site is built.
 *
 * Usage: node scripts/flipwarp-fetch-studio.js <studio id> <output file>
 */
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const API = process.env.FLIPWARP_STUDIO_API || 'https://api.scratch.mit.edu/studios';
const PER_PAGE = 40;
// Scratch stops answering somewhere past this; a studio holds 100 projects.
const MAX_PAGES = 10;

const fetchPage = async (studioId, offset) => {
    const url = `${API}/${studioId}/projects?limit=${PER_PAGE}&offset=${offset}`;
    const res = await fetch(url, {headers: {'User-Agent': 'Flipwarp build'}});
    if (!res.ok) throw new Error(`Scratch answered HTTP ${res.status} for ${url}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error('Scratch did not return a list of projects');
    return body;
};

const main = async () => {
    const [studioId, outFile] = process.argv.slice(2);
    if (!studioId || !outFile) {
        console.error('usage: node scripts/flipwarp-fetch-studio.js <studio id> <output file>');
        process.exit(1);
    }

    const projects = [];
    for (let page = 0; page < MAX_PAGES; page++) {
        const got = await fetchPage(studioId, page * PER_PAGE);
        // Only the three things the page shows. Everything else Scratch
        // returns is dropped here rather than written into the site.
        for (const p of got) {
            projects.push({id: p.id, title: String(p.title || ''), username: String(p.username || '')});
        }
        if (got.length < PER_PAGE) break;
    }

    fs.mkdirSync(path.dirname(outFile), {recursive: true});
    fs.writeFileSync(outFile, `${JSON.stringify(projects)}\n`);
    console.log(`studio ${studioId}: wrote ${projects.length} project(s) to ${outFile}`);
};

// A build must not fail because Scratch was briefly unreachable. When this
// cannot fetch the list it says so and leaves whatever was there before; the
// page falls back to the old way of getting it, which is what it did until
// now anyway.
main().catch(e => {
    console.error(`Could not fetch the studio: ${e.message}`);
    console.error('Leaving the featured projects to fall back. The build carries on.');
    process.exit(0);
});
