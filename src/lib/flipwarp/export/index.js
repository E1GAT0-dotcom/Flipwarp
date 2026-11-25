// "Export as code" in the editor: the project open in the VM, exported by package.js.
import webRuntime from '!raw-loader!./web-runtime.js';
import pythonRuntime from '!raw-loader!./python-runtime.py';
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

/**
 * Export the project open in the VM.
 * @param {object} vm the VM
 * @param {string} target a key of TARGETS
 * @param {string} title the project's name
 * @returns {Promise<{files: Array<[string, Uint8Array]>, notes: Array, folder: string}>} the export
 */
export const exportProject = (vm, target, title) => buildExport(vm.saveProjectSb3DontZip(), target, title,
    {weblab: webRuntime, python: pythonRuntime}, {rasterize});
