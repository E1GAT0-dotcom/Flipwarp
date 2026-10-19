// The drawing half of flipwarp-mcp: costumes made from SVG, from pixel art
// written as text, or from image files, and pictures of them so Claude can
// look at what it drew and fix it.
//
// Every costume goes in through the same upload the Costumes tab uses
// (costumeUpload), so it is sanitised and stored exactly as one a person
// added. Every change answers with a picture of the result: drawing blind is
// how the last attempt at this went wrong.

import {costumeUpload} from '../file-uploader.js';
import {pixelsToSvg, pixelsToRgba, PixelError} from './mcp-pixels.js';

const CELL = 160;
const LABEL = 30;

// --- turning a request into image bytes ----------------------------------

const base64ToBytes = base64 => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

const pngFromPixels = pixels => {
    const art = pixelsToRgba(pixels);
    const small = document.createElement('canvas');
    small.width = art.width;
    small.height = art.height;
    small.getContext('2d').putImageData(new ImageData(art.data, art.width, art.height), 0, 0);
    const big = document.createElement('canvas');
    big.width = art.width * art.scale;
    big.height = art.height * art.scale;
    const ctx = big.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, big.width, big.height);
    const url = big.toDataURL('image/png');
    return base64ToBytes(url.slice(url.indexOf(',') + 1));
};

// Scratch sizes an SVG costume by its viewBox and ignores width and height.
// A browser does the opposite, so an SVG whose two disagree looks one size in
// a preview and another on the stage: a 56x32 drawing with a 14x8 viewBox
// goes in as 14x8. Whoever wrote width and height meant them, so the drawing
// is fitted into a viewBox of that size, and both agree.
const length = value => {
    if (!value || /%$/.test(String(value).trim())) return null;
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : null;
};

export const normaliseSvg = text => {
    if (!/<svg[\s>]/i.test(text)) throw new Error('svg must be a whole <svg ...>...</svg> document.');
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const broken = doc.getElementsByTagName('parsererror')[0];
    if (broken) {
        const why = broken.textContent.replace(/\s+/g, ' ').trim()
            .slice(0, 300);
        throw new Error(`The SVG is not well formed: ${why}`);
    }
    const svg = doc.documentElement;
    const w = length(svg.getAttribute('width'));
    const h = length(svg.getAttribute('height'));
    const box = (svg.getAttribute('viewBox') || '').trim()
        .split(/[\s,]+/)
        .map(Number);
    const hasBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;
    if (!hasBox && !(w && h)) {
        throw new Error('The SVG needs a size: give it width and height (the size on the stage, in steps).');
    }
    if (!hasBox) {
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    } else if (!(w && h)) {
        svg.setAttribute('width', String(box[2]));
        svg.setAttribute('height', String(box[3]));
    } else if (Math.abs(box[2] - w) > 0.01 || Math.abs(box[3] - h) > 0.01 || box[0] || box[1]) {
        const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `scale(${w / box[2]} ${h / box[3]}) translate(${-box[0]} ${-box[1]})`);
        // Definitions stay where they are; everything drawn moves into the group.
        for (const child of [...svg.childNodes]) {
            if (child.nodeType === 1 && /^(defs|style|title|desc|metadata)$/i.test(child.localName)) continue;
            g.appendChild(child);
        }
        svg.appendChild(g);
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    return new XMLSerializer().serializeToString(svg);
};

/**
 * What was asked for, as bytes and a type. Exactly one of svg, pixels, png
 * or jpg.
 * @param {object} source the request
 * @returns {{bytes: Uint8Array, type: string, vector: boolean}} the image
 */
export const imageFrom = source => {
    const given = ['svg', 'pixels', 'png', 'jpg'].filter(k => source[k]);
    if (given.length !== 1) {
        throw new Error('Give exactly one of: svg (an SVG document), pixels (pixel art), or png / jpg ' +
            '(base64, or a file path on the server side).');
    }
    try {
        if (source.svg) {
            return {bytes: new TextEncoder().encode(normaliseSvg(source.svg)), type: 'image/svg+xml', vector: true};
        }
        if (source.pixels) {
            if (source.pixels.format === 'png') return {bytes: pngFromPixels(source.pixels), type: 'image/png'};
            return {bytes: new TextEncoder().encode(pixelsToSvg(source.pixels)), type: 'image/svg+xml', vector: true};
        }
        if (source.png) return {bytes: base64ToBytes(source.png), type: 'image/png'};
        return {bytes: base64ToBytes(source.jpg), type: 'image/jpeg'};
    } catch (e) {
        if (e instanceof PixelError) throw new Error(`Pixel art: ${e.message}`);
        throw e;
    }
};

const upload = (vm, image) => new Promise((resolve, reject) => {
    costumeUpload(image.bytes.buffer.slice(image.bytes.byteOffset, image.bytes.byteOffset + image.bytes.length),
        image.type, vm, costumes => resolve(costumes[0]),
        e => reject(new Error(`The image could not be read: ${e && e.message ? e.message : e}`)));
});

// --- finding costumes ------------------------------------------------------

// A costume by name, or by number counting from 1 the way Scratch does.
const indexOf = (target, costume) => {
    const costumes = target.getCostumes();
    if (typeof costume === 'number' || /^\d+$/.test(String(costume))) {
        const i = Number(costume) - 1;
        if (i >= 0 && i < costumes.length) return i;
    }
    const i = costumes.findIndex(c => c.name === costume);
    if (i >= 0) return i;
    throw new Error(`${target.getName()} has no costume "${costume}". It has: ` +
        `${costumes.map((c, n) => `${n + 1} "${c.name}"`).join(', ')}.`);
};

const describeCostume = (target, c, i) => {
    const size = c.size || [0, 0];
    // A bitmap is stored at twice its stage size; everything here is given
    // in stage steps, which for a bitmap is also the pixels of the image that
    // went in.
    const resolution = c.bitmapResolution || 1;
    return {
        number: i + 1,
        name: c.name,
        format: c.dataFormat,
        // How big it is on the stage at size 100.
        width: Math.round(size[0] / resolution),
        height: Math.round(size[1] / resolution),
        // Where it turns and where goToXY puts it, from its top left.
        center: {x: c.rotationCenterX / resolution, y: c.rotationCenterY / resolution},
        current: target.currentCostume === i
    };
};

// --- pictures ----------------------------------------------------------------

const loadImage = (bytes, type) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes], {type}));
    const img = new Image();
    img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('The browser could not draw this image. For SVG, check it is well formed ' +
            'and has width and height.'));
    };
    img.src = url;
});

const checker = (ctx, x, y, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#e4e4e4';
    for (let cy = 0; cy < h; cy += 10) {
        for (let cx = (cy / 10) % 2 ? 10 : 0; cx < w; cx += 20) ctx.fillRect(x + cx, y + cy, 10, 10);
    }
};

// One costume drawn as large as fits in a cell, on a checkerboard so what is
// see-through shows as see-through, with a cross where it turns.
const drawCell = (ctx, x, y, img, info, label) => {
    checker(ctx, x, y, CELL, CELL);
    const w = info.width || img.width;
    const h = info.height || img.height;
    const fit = Math.min((CELL - 16) / w, (CELL - 16) / h, 8);
    // Whole-number zoom for small images, so pixel art stays pixels.
    const zoom = fit >= 1 ? Math.floor(fit) : fit;
    const dw = w * zoom;
    const dh = h * zoom;
    const dx = x + ((CELL - dw) / 2);
    const dy = y + ((CELL - dh) / 2);
    ctx.imageSmoothingEnabled = !info.pixelated && zoom < 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.strokeRect(dx - 0.5, dy - 0.5, dw + 1, dh + 1);
    if (info.center) {
        const cx = dx + (info.center.x * zoom * (info.unitsToStage || 1));
        const cy = dy + (info.center.y * zoom * (info.unitsToStage || 1));
        ctx.strokeStyle = 'rgba(255,0,0,0.8)';
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy);
        ctx.lineTo(cx + 6, cy);
        ctx.moveTo(cx, cy - 6);
        ctx.lineTo(cx, cy + 6);
        ctx.stroke();
    }
    ctx.fillStyle = '#222';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label.slice(0, 24), x + (CELL / 2), y + CELL + 13);
    ctx.fillStyle = '#777';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${Math.round(w)}x${Math.round(h)}${zoom === 1 ? '' : `  (shown x${Math.round(zoom * 10) / 10})`}`,
        x + (CELL / 2), y + CELL + 26);
};

const sheet = cells => {
    const columns = Math.min(cells.length, 4);
    const rows = Math.ceil(cells.length / columns);
    const canvas = document.createElement('canvas');
    canvas.width = (columns * (CELL + 10)) + 10;
    canvas.height = (rows * (CELL + LABEL + 10)) + 10;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const [n, cell] of cells.entries()) {
        const x = 10 + ((n % columns) * (CELL + 10));
        const y = 10 + (Math.floor(n / columns) * (CELL + LABEL + 10));
        drawCell(ctx, x, y, cell.img, cell.info, cell.label);
    }
    const url = canvas.toDataURL('image/png');
    return url.slice(url.indexOf(',') + 1);
};

// A costume as it is stored, ready to draw. Bitmaps are kept at twice their
// stage size, so their units are half a step.
const costumeCell = async (c, i) => {
    const asset = c.asset;
    if (!asset || !asset.data) throw new Error(`Costume "${c.name}" has no image loaded.`);
    const type = c.dataFormat === 'svg' ? 'image/svg+xml' : `image/${c.dataFormat === 'jpg' ? 'jpeg' : c.dataFormat}`;
    const img = await loadImage(asset.data, type);
    const size = c.size || [img.width, img.height];
    const resolution = c.bitmapResolution || 1;
    return {
        img,
        label: `${i + 1}. ${c.name}`,
        info: {
            width: size[0] / resolution,
            height: size[1] / resolution,
            pixelated: c.dataFormat !== 'svg',
            center: {x: c.rotationCenterX, y: c.rotationCenterY},
            unitsToStage: 1 / resolution
        }
    };
};

const costumeSheet = async (target, which) => {
    const costumes = target.getCostumes();
    const indexes = which && which.length ? which.map(c => indexOf(target, c)) : costumes.map((_, i) => i);
    const cells = [];
    for (const i of indexes.slice(0, 24)) cells.push(await costumeCell(costumes[i], i));
    return sheet(cells);
};

// A drawing that is not a costume yet: shown big, and at the size it would be
// on the stage, side by side.
const previewImage = async image => {
    const img = await loadImage(image.bytes, image.type);
    // An image shows on the stage one step per pixel (a bitmap is stored at
    // double size and half resolution, which comes to the same thing), and an
    // SVG at its width and height, which normaliseSvg has made its viewBox.
    const w = img.width;
    const h = img.height;
    // Beside the zoomed view, the real size, when it fits: what the player
    // will see at size 100.
    const actual = w <= CELL - 16 && h <= CELL - 16;
    const out = document.createElement('canvas');
    out.width = ((actual ? 2 : 1) * (CELL + 10)) + 10;
    out.height = CELL + LABEL + 20;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(0, 0, out.width, out.height);
    drawCell(ctx, 10, 10, img, {width: w, height: h, pixelated: !image.vector}, 'zoomed');
    if (actual) {
        const x = CELL + 20;
        checker(ctx, x, 10, CELL, CELL);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, x + ((CELL - w) / 2), 10 + ((CELL - h) / 2), w, h);
        ctx.fillStyle = '#222';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('actual size on stage', x + (CELL / 2), CELL + 23);
    }
    const url = out.toDataURL('image/png');
    return {png: url.slice(url.indexOf(',') + 1), width: Math.round(w), height: Math.round(h)};
};

// --- changing costumes -------------------------------------------------------

const applyCenter = (costume, center, image) => {
    if (!center) return;
    // Given in the drawing's own units (SVG units, or image pixels); a bitmap
    // is stored at twice its stage size.
    const k = image.vector ? 1 : 2;
    costume.rotationCenterX = center.x * k;
    costume.rotationCenterY = center.y * k;
};

const addCostume = async (vm, target, {name, center, select = true, ...source}) => {
    const image = imageFrom(source);
    const costume = await upload(vm, image);
    costume.name = name || (source.pixels ? 'pixels' : 'costume');
    applyCenter(costume, center, image);
    const before = target.currentCostume;
    await vm.addCostume(costume.md5, costume, target.id);
    // Found rather than assumed to be last: the folders addon may move a new
    // costume next to the others in its folder.
    const index = target.getCostumes().indexOf(costume);
    if (!select) target.setCostume(before);
    vm.emitTargetsUpdate();
    return index;
};

const replaceCostume = async (vm, target, {costume: which, center, ...source}) => {
    const old = indexOf(target, which);
    const oldCostume = target.getCostumes()[old];
    const wasCurrent = target.currentCostume === old;
    const before = target.currentCostume;
    const image = imageFrom(source);
    const costume = await upload(vm, image);
    costume.name = `${oldCostume.name} new`;
    applyCenter(costume, center, image);
    // Loaded the ordinary way, which puts it at the end...
    await vm.addCostume(costume.md5, costume, target.id);
    // ...then swapped straight into the old one's place in the list, under
    // the old one's name, so every block that switches to it by name or
    // number still does. Not reorderCostume: the folders addon replaces that
    // with one that works from the Costumes tab's list, which is a different
    // sprite's whenever this one is not open there.
    const list = target.sprite.costumes;
    list.splice(list.indexOf(costume), 1);
    list.splice(old, 1, costume);
    costume.name = oldCostume.name;
    target.setCostume(wasCurrent ? old : before);
    vm.runtime.emitProjectChanged();
    vm.emitTargetsUpdate();
    return old;
};

// --- the requests ------------------------------------------------------------

/**
 * @param {function} targetNamed (vm, name) -> target, from the bridge
 * @returns {object} the costume requests
 */
export const costumeMethods = targetNamed => ({
    costumes: (vm, {sprite}) => {
        const target = targetNamed(vm, sprite);
        return {costumes: target.getCostumes().map((c, i) => describeCostume(target, c, i))};
    },

    addCostume: async (vm, {sprite, ...request}) => {
        const target = targetNamed(vm, sprite);
        const index = await addCostume(vm, target, request);
        const c = target.getCostumes()[index];
        return {costume: describeCostume(target, c, index), png: await costumeSheet(target, [index + 1])};
    },

    replaceCostume: async (vm, {sprite, ...request}) => {
        const target = targetNamed(vm, sprite);
        const index = await replaceCostume(vm, target, request);
        const c = target.getCostumes()[index];
        return {costume: describeCostume(target, c, index), png: await costumeSheet(target, [index + 1])};
    },

    renameCostume: (vm, {sprite, costume, name}) => {
        const target = targetNamed(vm, sprite);
        const i = indexOf(target, costume);
        target.renameCostume(i, name);
        vm.emitTargetsUpdate();
        return {costume: describeCostume(target, target.getCostumes()[i], i)};
    },

    deleteCostume: (vm, {sprite, costume}) => {
        const target = targetNamed(vm, sprite);
        if (target.getCostumes().length < 2) throw new Error('A sprite must keep at least one costume.');
        const i = indexOf(target, costume);
        const name = target.getCostumes()[i].name;
        target.deleteCostume(i);
        vm.runtime.emitProjectChanged();
        vm.emitTargetsUpdate();
        return {deleted: name, left: target.getCostumes().map(c => c.name)};
    },

    setCostume: (vm, {sprite, costume}) => {
        const target = targetNamed(vm, sprite);
        target.setCostume(indexOf(target, costume));
        vm.emitTargetsUpdate();
        return {current: target.getCostumes()[target.currentCostume].name};
    },

    costumeSheet: async (vm, {sprite, costumes}) => {
        const target = targetNamed(vm, sprite);
        return {png: await costumeSheet(target, costumes)};
    },

    previewImage: (vm, source) => previewImage(imageFrom(source))
});
