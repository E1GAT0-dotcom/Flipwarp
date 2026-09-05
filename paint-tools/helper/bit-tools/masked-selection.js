import paper from '@turbowarp/paper';

import {getRaster} from '../layer';
import {ART_BOARD_WIDTH, ART_BOARD_HEIGHT} from '../view';

/**
 * Lifting a shape that is not a rectangle out of the drawing.
 *
 * The rectangular select already does the hard half of this: it makes a
 * sub-raster of the region, marks it selected, and hands it to the bounding
 * box tool, which is what actually moves, scales, deletes and commits it. So a
 * magic wand and a lasso do not need any of that again — they only need to
 * decide which pixels are in, and then hand over a sub-raster that has
 * everything else in its rectangle rubbed out.
 *
 * A mask here is one byte per pixel of a rectangle: 1 for in, 0 for out.
 */

/**
 * Every pixel of the drawing, as one flat array of bytes.
 * @return {ImageData} The whole board.
 */
const readBoard = () => {
    const context = getRaster().getContext();
    return context.getImageData(0, 0, ART_BOARD_WIDTH, ART_BOARD_HEIGHT);
};

/**
 * The rectangle a mask actually occupies, which is usually far smaller than
 * the rectangle it was measured over — a wand click on one letter of a word
 * searches the whole board but ends up owning a few hundred pixels.
 *
 * @param {Uint8Array} mask One byte per pixel, board-sized.
 * @return {?paper.Rectangle} The tight bounds, or null if the mask is empty.
 */
const maskBounds = mask => {
    let top = ART_BOARD_HEIGHT;
    let bottom = -1;
    let left = ART_BOARD_WIDTH;
    let right = -1;
    for (let y = 0; y < ART_BOARD_HEIGHT; y++) {
        const row = y * ART_BOARD_WIDTH;
        for (let x = 0; x < ART_BOARD_WIDTH; x++) {
            if (!mask[row + x]) continue;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
            if (x < left) left = x;
            if (x > right) right = x;
        }
    }
    if (bottom < 0) return null;
    return new paper.Rectangle(left, top, (right - left) + 1, (bottom - top) + 1);
};

/**
 * Turn a mask into the selection the rest of the paint editor understands.
 *
 * @param {Uint8Array} mask One byte per pixel, board-sized. 1 means selected.
 * @param {function} setSelectedItems Callback to tell Redux the selection changed.
 * @return {boolean} True if anything was selected.
 */
const liftMask = (mask, setSelectedItems) => {
    const bounds = maskBounds(mask);
    if (!bounds || !bounds.area) return false;

    const raster = getRaster();
    const selection = raster.getSubRaster(bounds);
    selection.parent = paper.project.activeLayer;
    const context = selection.canvas.getContext('2d');
    context.imageSmoothingEnabled = false;

    // Rub out everything inside the rectangle that the mask did not choose.
    // Without this a wand click on a circle would drag a square around with it.
    const lifted = context.getImageData(0, 0, bounds.width, bounds.height);
    for (let y = 0; y < bounds.height; y++) {
        const from = ((y + bounds.y) * ART_BOARD_WIDTH) + bounds.x;
        const to = y * bounds.width;
        for (let x = 0; x < bounds.width; x++) {
            if (!mask[from + x]) lifted.data[((to + x) * 4) + 3] = 0;
        }
    }
    context.putImageData(lifted, 0, 0);
    selection.selected = true;

    // And take the same pixels out of the drawing underneath, so the selection
    // is being moved rather than copied. Only the chosen ones: the rectangular
    // select can clear its whole rectangle, this cannot.
    const board = getRaster().getContext(true /* modify */);
    const under = board.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
    for (let y = 0; y < bounds.height; y++) {
        const from = ((y + bounds.y) * ART_BOARD_WIDTH) + bounds.x;
        const to = y * bounds.width;
        for (let x = 0; x < bounds.width; x++) {
            if (mask[from + x]) under.data[((to + x) * 4) + 3] = 0;
        }
    }
    board.putImageData(under, bounds.x, bounds.y);

    setSelectedItems();
    return true;
};

export {
    readBoard,
    maskBounds,
    liftMask
};
