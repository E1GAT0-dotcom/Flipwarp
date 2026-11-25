// "Export as code" in the editor: the project open in the VM, exported by package.js.
import webRuntime from '!raw-loader!./web-runtime.js';
import pythonRuntime from '!raw-loader!./python-runtime.py';
import gameLabRuntime from '!raw-loader!./gamelab-runtime.js';
import {buildExport, TARGETS} from './package.js';

export {TARGETS};

// SVG costumes drawn as PNGs at twice their size, for targets whose own SVG
// support is thin (pygame's leaves out text and much else).
const SCALE = 2;
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
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(blob => {
                URL.revokeObjectURL(url);
                if (!blob) {
                    reject(new Error('The picture could not be drawn.'));
                    return;
                }
                blob.arrayBuffer().then(buffer => resolve({data: new Uint8Array(buffer), scale: SCALE}), reject);
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
            URL.revokeObjectURL(url);
            resolve(right < 0 ? {width: w, height: h, box: [w / 2, h / 2, w / 2, h / 2]} :
                {width: w, height: h, box: [left, top, right + 1, bottom + 1]});
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
 * @returns {Promise<{files: Array<[string, Uint8Array]>, notes: Array, folder: string}>} the export
 */
export const exportProject = (vm, target, title) => buildExport(vm.saveProjectSb3DontZip(), target, title,
    {weblab: webRuntime, python: pythonRuntime, gamelab: gameLabRuntime}, {rasterize, measure});
