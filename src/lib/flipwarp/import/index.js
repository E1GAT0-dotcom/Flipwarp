// File > Import from Code.org: files from Code.org (or Flipwarp's own exports)
// made into a Scratch project (.sb3), which the editor then loads like any
// other. Two kinds of code come in:
// - Flipwarp's exports (Web Lab, Game Lab, Python), which carry the project
//   they were made from (restore.js), even after being edited on Code.org;
// - any other Game Lab program, translated into sprites and blocks (gamelab.js).

import JSZip from 'jszip';
import md5 from 'js-md5';
import {hasSource, unpackSource} from '../export/source.js';
import {restoreExport} from './restore.js';
import {translateGameLab} from './gamelab.js';

const TEXT = /\.(html?|js|py|txt|json|css|md)$/i;
const extOf = name => (/\.([^./]+)$/.exec(name) || [])[1] || '';
const baseOf = path => String(path).split(/[\\/]/).pop();

// Every file given, with zips opened (a folder inside one is fine).
const gather = async files => {
    const out = [];
    for (const f of files) {
        if (/\.zip$/i.test(f.name)) {
            const zip = await JSZip.loadAsync(f.data);
            for (const entry of Object.values(zip.files)) {
                if (entry.dir || /(^|\/)(__MACOSX|\.DS_Store)/.test(entry.name)) continue;
                out.push({name: baseOf(entry.name), path: entry.name, data: await entry.async('uint8array')});
            }
            continue;
        }
        out.push({name: baseOf(f.name), path: f.name, data: f.data});
    }
    for (const f of out) if (TEXT.test(f.name)) f.text = new TextDecoder().decode(f.data);
    return out;
};

const fromBase64 = text => {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

// "name": "data:...;base64,..." pairs, as the Web Lab page and Game Lab's costumePictures() hold them.
const dataUrls = text => {
    const out = new Map();
    const re = /"((?:[^"\\]|\\.)*)"\s*:\s*"data:([^;",]+);base64,([A-Za-z0-9+/=]*)"/g;
    let m;
    while ((m = re.exec(text))) {
        let key = m[1];
        try {
            key = JSON.parse(`"${m[1]}"`);
        } catch (e) {
            // Kept as written.
        }
        out.set(key, {mime: m[2], b64: m[3]});
    }
    return out;
};

// The packs a big Web Lab export is put in (export/package.js makePacks).
const unpack = data => {
    const out = new Map();
    if (data.length < 8 || String.fromCharCode(...data.subarray(0, 4)) !== 'FWPK') return out;
    const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, true);
    const index = JSON.parse(new TextDecoder().decode(data.subarray(8, 8 + length)));
    const start = 8 + length;
    for (const [file, , offset, size] of index) out.set(file, data.subarray(start + offset, start + offset + size));
    return out;
};

const MIME_EXT = {'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif',
    'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg'};
const SCRATCH_PICTURES = new Set(['png', 'jpg', 'svg', 'gif']);

/**
 * The game's code inside the file that carries the project: the Web Lab page's
 * game script, or the whole file.
 * @param {object} file the file
 * @returns {string} the code
 */
const codeIn = file => {
    if (!/\.html?$/i.test(file.name)) return file.text;
    const scripts = [...file.text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    const game = scripts.find(s => hasSource(s)) || scripts.find(s => /new ScratchGame\(/.test(s)) || '';
    return game.replace(/<\\\/script/gi, '</script');
};

/**
 * Turn files from Code.org into a Scratch project.
 * @param {Array<{name: string, data: Uint8Array}>} files what was chosen (zips are opened)
 * @param {object} helpers {redraw(data, mime, factor) -> Promise<Uint8Array>}: a picture redrawn as a PNG,
 *     scaled by factor (the editor does it with a canvas)
 * @returns {Promise<{sb3: Uint8Array, title: string, notes: Array<string>, kind: string}>} the project
 */
export const importCodeOrg = async (files, helpers = {}) => {
    const all = await gather(files);
    const byName = new Map();
    for (const f of all) {
        if (!byName.has(f.name.toLowerCase())) byName.set(f.name.toLowerCase(), f);
    }
    // The code itself, not START-HERE.html, which holds a copy of it for its Copy button.
    const carriers = all.filter(f => f.text && hasSource(f.text));
    const rank = f => {
        const n = f.name.toLowerCase();
        if (['code.js', 'main.py', 'game.js', 'index.html'].includes(n)) return 0;
        if (/\.(js|py)$/.test(n)) return 1;
        if (/start-here/.test(n)) return 3;
        return 2;
    };
    const carrier = carriers.sort((a, b) => rank(a) - rank(b))[0];

    let result;
    let kind;
    if (carrier) {
        const source = await unpackSource(carrier.text);
        kind = source.target;
        const code = codeIn(carrier);
        // Pictures and sounds carried in the page or the code, and in packs.
        const tables = new Map();
        for (const f of all) {
            if (f.text && /data:/.test(f.text)) for (const [k, v] of dataUrls(f.text)) tables.set(k, v);
            if (!f.text && f.data.length > 8) for (const [k, v] of unpack(f.data)) tables.set(k, {bytes: v});
        }
        const fileData = name => {
            const f = byName.get(String(name).toLowerCase());
            if (f) return f.data;
            const t = tables.get(name);
            if (!t) return null;
            return t.bytes || fromBase64(t.b64);
        };
        // A picture at another scale (or in a format Scratch does not keep) made a PNG at 1 or 2 pixels a unit.
        const normalize = async (data, ext, resolution) => {
            const res = resolution >= 1.5 ? 2 : 1;
            if (SCRATCH_PICTURES.has(ext) && Math.abs(res - resolution) < 1e-6) {
                return {data, ext: ext === 'jpeg' ? 'jpg' : ext, resolution: res};
            }
            if (!helpers.redraw) return {data, ext, resolution};
            const png = await helpers.redraw(data, `image/${ext === 'jpg' ? 'jpeg' : ext}`, res / resolution);
            return {data: png, ext: 'png', resolution: res};
        };
        const withId = got => ({...got, md5ext: `${md5(got.data)}.${got.ext}`});
        const findAsset = async (entry, md5ext) => {
            const ext = extOf(md5ext).toLowerCase();
            if (!entry) {
                const data = fileData(md5ext);
                return data ? {data} : null;
            }
            if (typeof entry.t === 'string') return {data: new TextEncoder().encode(entry.t)};
            if (entry.a) {
                const t = tables.get(entry.a);
                if (!t) return null;
                const got = await normalize(fromBase64(t.b64), MIME_EXT[t.mime] || 'png', entry.r || 1);
                return withId(got);
            }
            if (entry.f) {
                const data = fileData(entry.f);
                if (!data) return null;
                const fileExt = extOf(entry.f).toLowerCase();
                if (entry.r) return withId(await normalize(data, fileExt, entry.r));
                if (fileExt && fileExt !== ext) return withId({data, ext: fileExt});
                return {data};
            }
            return null;
        };
        result = await restoreExport(source, code, findAsset);
    } else {
        // Game Lab code uses Game Lab's own words: createSprite, drawSprites, function draw...
        const looksLikeGameLab = text => /\b(createSprite|drawSprites|createEdgeSprites|keyDown|keyWentDown|playSound)\s*\(|function\s+draw\s*\(|\b(background|rect|ellipse|text)\s*\(/.test(text);
        const gameLab = all.find(f => f.text && /\.json$/i.test(f.name) && /"source"\s*:/.test(f.text)) ||
            all.find(f => f.text && /\.js$/i.test(f.name) && looksLikeGameLab(f.text));
        if (!gameLab) {
            const page = all.some(f => /\.html?$/i.test(f.name));
            throw new Error(page ?
                'This looks like a Web Lab website, not a game Flipwarp exported: only Web Lab pages made by ' +
                'File > Export as code (from now on) can come back as Scratch projects.' :
                'There is no Game Lab program here. Choose a Game Lab program (.js), or a .zip, page or program ' +
                'that Flipwarp exported.');
        }
        if (/\.html?$/i.test(gameLab.name) || /new ScratchGame\(/.test(gameLab.text)) {
            throw new Error('This page was exported by an older Flipwarp, which did not carry the project with it. ' +
                'Export it again from Flipwarp, then import that.');
        }
        kind = 'gamelab-code';
        result = await translateGameLab(gameLab, all, helpers);
    }

    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(result.project));
    for (const [name, data] of Object.entries(result.assets)) zip.file(name, data);
    const sb3 = await zip.generateAsync({type: 'uint8array', compression: 'DEFLATE'});
    return {sb3, title: result.title, notes: result.notes, kind};
};
