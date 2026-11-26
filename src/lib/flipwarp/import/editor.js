// File > Import from Code.org, in the editor: the chosen files read, made into
// an .sb3 by index.js (pictures redrawn with a canvas where they need it), and
// what did not come across shown once the project has loaded.
import {importCodeOrg} from './index.js';

const loadImage = (data, mime) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([data], {type: mime}));
    const image = new Image();
    image.onload = () => resolve({image, url});
    image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('A picture could not be read.'));
    };
    image.src = url;
});
const canvasPng = canvas => new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
        if (!blob) {
            reject(new Error('A picture could not be drawn.'));
            return;
        }
        blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject);
    }, 'image/png');
});

// A picture redrawn as a PNG, scaled by factor.
const redraw = async (data, mime, factor) => {
    const {image, url} = await loadImage(data, mime);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * factor));
        canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * factor));
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        return await canvasPng(canvas);
    } finally {
        URL.revokeObjectURL(url);
    }
};
// Part of a picture (one frame of a Game Lab animation's sheet) as a PNG.
const crop = async (data, mime, x, y, width, height) => {
    const {image, url} = await loadImage(data, mime);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, width, height);
        return await canvasPng(canvas);
    } finally {
        URL.revokeObjectURL(url);
    }
};

/**
 * The chosen files as an .sb3, ready for the editor to load.
 * @param {FileList|Array<File>} chosen what was picked
 * @returns {Promise<{file: File, notes: Array<string>, title: string}>} the project as a file, and what did not come across
 */
export const importChosenFiles = async chosen => {
    const files = [];
    for (const f of Array.from(chosen)) files.push({name: f.name, data: new Uint8Array(await f.arrayBuffer())});
    const result = await importCodeOrg(files, {redraw, crop});
    const title = String(result.title || 'Project').replace(/[\\/:*?"<>|]+/g, ' ')
        .trim()
        .slice(0, 100) || 'Project';
    return {file: new File([result.sb3], `${title}.sb3`, {type: 'application/x.scratch.sb3'}), notes: result.notes,
        title, kind: result.kind};
};

// The file types the picker offers.
export const IMPORT_ACCEPT = '.zip,.js,.json,.html,.htm,.py,.png,.jpg,.jpeg,.gif,.webp,.svg,.mp3,.wav,.ogg';

/**
 * A box over the editor listing what did not come across.
 * @param {string} heading what was imported
 * @param {Array<string>} notes what to say
 */
export const showImportNotes = (heading, notes) => {
    if (!notes || !notes.length) return;
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:10000;' +
        'background:#fff;border-radius:10px;box-shadow:0 6px 30px rgba(0,0,0,.25);padding:18px 22px;width:460px;' +
        'max-width:90vw;max-height:70vh;overflow:auto;font:14px Helvetica,Arial,sans-serif;color:#575e75';
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:bold;margin-bottom:8px';
    title.textContent = heading;
    const list = document.createElement('ul');
    list.style.cssText = 'margin:0 0 12px;padding-left:18px';
    for (const n of notes.slice(0, 30)) {
        const li = document.createElement('li');
        li.style.marginBottom = '4px';
        li.textContent = n;
        list.appendChild(li);
    }
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    ok.style.cssText = 'border:none;background:#855cd6;color:#fff;border-radius:6px;padding:6px 18px;font-size:14px;' +
        'cursor:pointer;float:right';
    ok.onclick = () => box.remove();
    box.append(title, list, ok);
    document.body.appendChild(box);
};
