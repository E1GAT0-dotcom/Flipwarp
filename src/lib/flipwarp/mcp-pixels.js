// Pixel art as text: a palette of single characters and rows of them.
//
//   palette: {"k": "#000000", "s": "#f4c08a"}
//   rows:    ["..kk..",
//             ".kssk.",
//             "..kk.."]
//
// "." and " " are see-through unless the palette says otherwise. It is the
// form a language model draws best in: every pixel is one character, each
// row lines up under the last, and a mistake has a row and a column.
//
// No browser needed here, so it is tested on its own.

export const MAX_SIDE = 256;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CLEAR = new Set(['transparent', 'none', 'clear', '']);

export class PixelError extends Error {}

const normaliseColour = (key, value) => {
    if (value === null || (typeof value === 'string' && CLEAR.has(value.trim().toLowerCase()))) return null;
    if (typeof value !== 'string' || !HEX.test(value.trim())) {
        throw new PixelError(`Palette "${key}" is ${JSON.stringify(value)}. Colours are hex, like "#ff8800" ` +
            'or "#ff880080" with alpha, or "transparent".');
    }
    let hex = value.trim().slice(1)
        .toLowerCase();
    if (hex.length <= 4) {
        hex = hex.split('').map(c => c + c)
            .join('');
    }
    return `#${hex}`;
};

/**
 * Check pixel art and put it in one shape.
 * @param {object} pixels {palette, rows, scale}
 * @returns {{width: number, height: number, scale: number, rows: string[], colours: Map}} the art
 */
export const readPixels = pixels => {
    if (!pixels || typeof pixels !== 'object') throw new PixelError('pixels needs a palette and rows.');
    let rows = pixels.rows;
    if (typeof rows === 'string') rows = rows.split('\n');
    if (!Array.isArray(rows) || !rows.length) throw new PixelError('rows is a list of strings, one per row.');
    // A trailing empty row is a newline at the end, not a row.
    while (rows.length && rows[rows.length - 1] === '') rows = rows.slice(0, -1);

    const palette = pixels.palette || {};
    const colours = new Map([['.', null], [' ', null]]);
    for (const [key, value] of Object.entries(palette)) {
        if ([...key].length !== 1) {
            throw new PixelError(`Palette keys are single characters; "${key}" is not.`);
        }
        colours.set(key, normaliseColour(key, value));
    }

    const width = [...rows[0]].length;
    if (!width) throw new PixelError('Row 1 is empty.');
    if (width > MAX_SIDE || rows.length > MAX_SIDE) {
        throw new PixelError(`The art is ${width}x${rows.length}; the most is ${MAX_SIDE}x${MAX_SIDE}. ` +
            'Use scale to make it bigger on the stage instead.');
    }
    rows.forEach((row, y) => {
        if (typeof row !== 'string') throw new PixelError(`Row ${y + 1} is not a string.`);
        const chars = [...row];
        if (chars.length !== width) {
            throw new PixelError(`Row ${y + 1} is ${chars.length} pixels wide, but row 1 is ${width}. ` +
                'Every row must be the same width; pad with "." for see-through.');
        }
        chars.forEach((c, x) => {
            if (!colours.has(c)) {
                throw new PixelError(`Row ${y + 1}, column ${x + 1} is "${c}", which is not in the palette.`);
            }
        });
    });

    const scale = typeof pixels.scale === 'undefined' ? 4 : Number(pixels.scale);
    if (!Number.isInteger(scale) || scale < 1 || scale > 32) {
        throw new PixelError('scale is how many stage steps one pixel covers: a whole number from 1 to 32.');
    }
    if (width * scale > 960 || rows.length * scale > 720) {
        throw new PixelError(`At scale ${scale} the costume would be ${width * scale}x${rows.length * scale}, ` +
            'bigger than twice the stage. Use a smaller scale.');
    }
    return {width, height: rows.length, scale, rows: rows.map(r => [...r]), colours};
};

const splitAlpha = hex => (hex.length === 9 ?
    {fill: hex.slice(0, 7), opacity: Math.round(parseInt(hex.slice(7), 16) / 255 * 1000) / 1000} :
    {fill: hex, opacity: 1});

/**
 * Pixel art as an SVG: one rectangle per run of the same colour in a row, so
 * a 32x32 sprite is a few hundred shapes rather than a thousand, drawn with
 * crisp edges so the pixels stay pixels at any size.
 * @param {object} pixels {palette, rows, scale}
 * @returns {string} the SVG
 */
export const pixelsToSvg = pixels => {
    const art = readPixels(pixels);
    const {width, height, scale} = art;
    const byColour = new Map();
    art.rows.forEach((row, y) => {
        let x = 0;
        while (x < width) {
            const colour = art.colours.get(row[x]);
            let end = x + 1;
            while (end < width && art.colours.get(row[end]) === colour) end++;
            if (colour) {
                if (!byColour.has(colour)) byColour.set(colour, []);
                byColour.get(colour).push(`M${x} ${y}h${end - x}v1h${x - end}z`);
            }
            x = end;
        }
    });
    const paths = [...byColour].map(([colour, parts]) => {
        const {fill, opacity} = splitAlpha(colour);
        return `<path fill="${fill}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''} d="${parts.join('')}"/>`;
    });
    // Scratch sizes an SVG by its viewBox, not its width and height, so the
    // viewBox is the full size and the pixels are scaled up inside it.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" ` +
        `viewBox="0 0 ${width * scale} ${height * scale}" shape-rendering="crispEdges">` +
        `<g transform="scale(${scale})">${paths.join('')}</g></svg>`;
};

/**
 * Pixel art as RGBA bytes at one byte-quad per art pixel, for drawing onto a
 * canvas and scaling up there.
 * @param {object} pixels {palette, rows, scale}
 * @returns {{width: number, height: number, scale: number, data: Uint8ClampedArray}} the image
 */
export const pixelsToRgba = pixels => {
    const art = readPixels(pixels);
    const data = new Uint8ClampedArray(art.width * art.height * 4);
    art.rows.forEach((row, y) => row.forEach((c, x) => {
        const colour = art.colours.get(c);
        if (!colour) return;
        const i = ((y * art.width) + x) * 4;
        data[i] = parseInt(colour.slice(1, 3), 16);
        data[i + 1] = parseInt(colour.slice(3, 5), 16);
        data[i + 2] = parseInt(colour.slice(5, 7), 16);
        data[i + 3] = colour.length === 9 ? parseInt(colour.slice(7, 9), 16) : 255;
    }));
    return {width: art.width, height: art.height, scale: art.scale, data};
};
