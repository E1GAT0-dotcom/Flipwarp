// Pixel art written as text: a mistake has to be caught with its row and
// column, because Claude fixes what it is told about and nothing else, and a
// correct drawing has to come out as exactly those pixels.
//
// Runs without a browser.
import {readPixels, pixelsToSvg, pixelsToRgba, PixelError} from '../../src/lib/flipwarp/mcp-pixels.js';

let failures = 0;
const check = (ok, what) => {
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const refuses = (pixels, includes, what) => {
    try {
        readPixels(pixels);
        check(false, `${what} (was accepted)`);
    } catch (e) {
        check(e instanceof PixelError && e.message.includes(includes), `${what}: ${e.message}`);
    }
};

const heart = {
    palette: {r: '#e33', k: '#000000', w: '#ffffff80'},
    rows: [
        '.kk.kk.',
        'krrkrrk',
        'krwrrrk',
        '.krrrk.',
        '..krk..',
        '...k...'
    ],
    scale: 3
};

const art = readPixels(heart);
check(art.width === 7 && art.height === 6 && art.scale === 3, 'size and scale are read');
check(art.colours.get('r') === '#ee3333', 'short hex is widened');
check(art.colours.get('.') === null, '"." is see-through by default');

const svg = pixelsToSvg(heart);
check(svg.includes('width="21" height="18"') && svg.includes('viewBox="0 0 21 18"') && svg.includes('scale(3)'), 'the SVG is scaled');
check(svg.includes('shape-rendering="crispEdges"'), 'the SVG keeps hard edges');
check(svg.includes('fill-opacity="0.502"'), 'alpha becomes opacity');
// Row 2 is k rr k rr k: the two red runs are separate rectangles, the
// black is three one-pixel ones.
check((svg.match(/M\d+ 1h/g) || []).length === 5, 'one shape per run of a colour in a row');

const rgba = pixelsToRgba(heart);
const at = (x, y) => Array.from(rgba.data.slice(((y * 7) + x) * 4, (((y * 7) + x) * 4) + 4)).join(',');
check(at(0, 0) === '0,0,0,0', 'see-through stays see-through');
check(at(1, 0) === '0,0,0,255', 'black is black');
check(at(2, 2) === '255,255,255,128', 'alpha is kept');
check(at(3, 5) === '0,0,0,255', 'the last row is drawn');

const rowsAsText = readPixels({palette: {a: '#123'}, rows: 'aa\naa\n'});
check(rowsAsText.height === 2, 'rows can be one string with a newline at the end');

refuses({palette: {a: '#000'}, rows: ['aaa', 'aa']}, 'Row 2 is 2 pixels wide', 'a short row');
refuses({palette: {a: '#000'}, rows: ['aab']}, 'Row 1, column 3 is "b"', 'a character not in the palette');
refuses({palette: {a: 'red'}, rows: ['a']}, 'Colours are hex', 'a colour name');
refuses({palette: {ab: '#000'}, rows: ['a']}, 'single characters', 'a two-letter key');
refuses({palette: {a: '#000'}, rows: ['a'], scale: 0}, 'whole number from 1 to 32', 'a zero scale');
refuses({palette: {a: '#000'}, rows: ['a'.repeat(200)], scale: 8}, 'bigger than twice the stage', 'too big');
refuses({palette: {a: '#000'}, rows: []}, 'rows is a list', 'no rows');

if (failures) {
    console.log(`${failures} failure(s)`);
    process.exit(1);
}
console.log('pixel art reads, draws, and refuses mistakes with their place');
