// "Export as code" in the editor: the project open in the VM, exported by package.js.
import webRuntime from '!raw-loader!./web-runtime.js';
import pythonRuntime from '!raw-loader!./python-runtime.py';
import gameLabRuntime from '!raw-loader!./gamelab-runtime.js';
import {buildExport, TARGETS} from './package.js';
import {encodeMp3} from './mp3.js';

export {TARGETS};

// SVG costumes drawn as PNGs at twice their size, for targets whose own SVG
// support is thin (pygame's leaves out text and much else).
const SCALE = 2;

// A drawn picture's size and the box of its drawn pixels (the outermost ones' edges).
const boxOf = (ctx, w, h) => {
    const pixels = ctx.getImageData(0, 0, w, h).data;
    let left = w;
    let top = h;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (pixels[(((y * w) + x) * 4) + 3] > 0) {
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
    }
    return right < 0 ? {width: w, height: h, box: [w / 2, h / 2, w / 2, h / 2]} :
        {width: w, height: h, box: [left, top, right + 1, bottom + 1]};
};
// The pictures this export drew, with their measurements.
const drawn = new WeakMap();

const rasterize = data => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([data], {type: 'image/svg+xml'}));
    const image = new Image();
    image.onload = () => {
        try {
            const width = image.naturalWidth || image.width;
            const height = image.naturalHeight || image.height;
            if (!width || !height) throw new Error('The SVG has no size.');
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * SCALE));
            canvas.height = Math.max(1, Math.round(height * SCALE));
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            // Measured now, while the pixels are here, rather than read back in later.
            const size = boxOf(ctx, canvas.width, canvas.height);
            canvas.toBlob(blob => {
                URL.revokeObjectURL(url);
                if (!blob) {
                    reject(new Error('The picture could not be drawn.'));
                    return;
                }
                blob.arrayBuffer().then(buffer => {
                    const png = new Uint8Array(buffer);
                    drawn.set(png, size);
                    resolve({data: png, scale: SCALE});
                }, reject);
            }, 'image/png');
        } catch (e) {
            URL.revokeObjectURL(url);
            reject(e);
        }
    };
    image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('The SVG could not be read.'));
    };
    image.src = url;
});

// A picture's size and the box of its drawn pixels, measured from the centre of
// the outermost ones as Scratch does, for targets that cannot read pixels
// themselves (Game Lab).
const MIME = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', gif: 'image/gif'};
const measure = (data, ext) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([data], {type: MIME[ext] || 'image/png'}));
    const image = new Image();
    image.onload = () => {
        try {
            const w = image.naturalWidth || image.width;
            const h = image.naturalHeight || image.height;
            if (!w || !h) throw new Error('The picture has no size.');
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            const size = boxOf(ctx, w, h);
            URL.revokeObjectURL(url);
            resolve(size);
        } catch (e) {
            URL.revokeObjectURL(url);
            reject(e);
        }
    };
    image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('The picture could not be read.'));
    };
    image.src = url;
});

/**
 * A smaller copy of a picture, for carrying inside code (Game Lab): drawn at a
 * smaller scale and saved as WebP (PNG where the browser cannot write WebP).
 * @param {Uint8Array} data the picture
 * @param {string} ext its format
 * @param {number} factor how much to shrink it by (1 or less)
 * @param {number} quality WebP quality, 0 to 1
 * @returns {Promise<{data: Uint8Array, ext: string, scale: number}>} the copy, and the scale it was drawn at
 */
const compact = (data, ext, factor, quality) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([data], {type: MIME[ext] || 'image/png'}));
    const image = new Image();
    image.onload = () => {
        try {
            const w = image.naturalWidth || image.width;
            const h = image.naturalHeight || image.height;
            if (!w || !h) throw new Error('The picture has no size.');
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(w * Math.min(1, factor)));
            canvas.height = Math.max(1, Math.round(h * Math.min(1, factor)));
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            canvas.toBlob(blob => {
                if (!blob) {
                    reject(new Error('The picture could not be drawn.'));
                    return;
                }
                blob.arrayBuffer().then(buffer => resolve({
                    data: new Uint8Array(buffer),
                    ext: blob.type === 'image/webp' ? 'webp' : 'png',
                    scale: canvas.width / w
                }), reject);
            }, 'image/webp', quality);
        } catch (e) {
            URL.revokeObjectURL(url);
            reject(e);
        }
    };
    image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('The picture could not be read.'));
    };
    image.src = url;
});

/**
 * Export the project open in the VM.
 * @param {object} vm the VM
 * @param {string} target a key of TARGETS
 * @param {string} title the project's name
 * @param {function} [onProgress] called with {label, done, total} as it goes
 * @returns {Promise<{files: Array<[string, Uint8Array]>, notes: Array, folder: string}>} the export
 */
export const exportProject = (vm, target, title, onProgress) => {
    // Every sound as the VM decoded it, by its file name, for MP3s.
    const decoded = {};
    for (const t of vm.runtime.targets) {
        if (!t.isOriginal || !t.sprite) continue;
        const bank = t.sprite.soundBank;
        for (const sound of t.sprite.sounds) {
            const player = bank && bank.soundPlayers && bank.soundPlayers[sound.soundId];
            const file = sound.md5 || `${sound.assetId}.${sound.dataFormat}`;
            if (player && player.buffer) decoded[file] = player.buffer;
        }
    }
    const toMp3 = async file => (decoded[file] ? encodeMp3(decoded[file]) : null);
    return buildExport(vm.saveProjectSb3DontZip(), target, title,
        {weblab: webRuntime, python: pythonRuntime, gamelab: gameLabRuntime},
        {rasterize, measure, compact, lastDrawn: data => drawn.get(data) || null, progress: onProgress, toMp3});
};

/**
 * A progress bar over the page, for an export started from the menu.
 * @param {string} title what is being made
 * @returns {{update: function, close: function}} set it as it goes; take it away
 */
export const showExportProgress = title => {
    const box = document.createElement('div');
    box.setAttribute('role', 'progressbar');
    box.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:10000;' +
        'background:#fff;border-radius:10px;box-shadow:0 6px 30px rgba(0,0,0,.25);padding:18px 22px;width:340px;' +
        'font:14px Helvetica,Arial,sans-serif;color:#575e75';
    box.innerHTML = '<div style="font-weight:bold;margin-bottom:6px"></div><div data-label style="margin-bottom:10px">' +
        'Getting the project ready...</div><div style="height:10px;border-radius:5px;background:#e9eef2;' +
        'overflow:hidden"><div data-bar style="height:100%;width:3%;background:#855cd6;transition:width .2s">' +
        '</div></div>';
    box.firstChild.textContent = title;
    document.body.appendChild(box);
    const label = box.querySelector('[data-label]');
    const bar = box.querySelector('[data-bar]');
    return {
        update: (text, fraction) => {
            label.textContent = text;
            box.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
            bar.style.width = `${Math.max(3, Math.min(100, fraction * 100))}%`;
        },
        close: () => box.remove()
    };
};
