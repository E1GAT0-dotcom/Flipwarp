// An easter egg: with Cat Blocks turned on, the Konami code turns the cats
// into shibas until the page is reloaded.
//
// Nothing is saved and nothing is announced. If Cat Blocks is off, the code
// does nothing at all — there are no faces to change.

import LazyScratchBlocks from '../tw-lazy-scratch-blocks';

const SEQUENCE = [
    'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'
];

// The cat's ears are pink inside. A shiba's are the same tan as the rest.
const EAR_INSIDE = '#C58C4E';

let installed = false;
let doged = false;

/**
 * Draw a shiba face instead of a cat one.
 *
 * Deliberately the same set of elements the cat uses — two eyes, two closed
 * eyes, a mouth — because the addon's own blink and ear-flick handlers reach
 * for them by name. A doge that could not blink would be a worse joke.
 *
 * The coordinates match the cat's: the head sits roughly between x 12 and 85,
 * with the brow line a little above y = -3.
 *
 * @param {object} block the hat block being drawn
 * @param {object} Blockly the loaded scratch-blocks
 */
const drawDogeFace = (block, Blockly) => {
    const svg = (type, attrs, parent) => {
        const el = Blockly.utils.createSvgElement(type, {}, parent);
        for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
        return el;
    };

    // A pale muzzle, the thing that reads as "dog" before any detail does.
    // Sits low, around the nose and mouth: any higher and it reaches up into
    // the brows, which makes the whole face look like it has slipped.
    svg('ellipse', {
        'cx': '44.2',
        'cy': '0.4',
        'rx': '12.5',
        'ry': '5.8',
        'fill': '#FFFFFF',
        'fill-opacity': '0.22'
    }, block.svgFace_);

    // Brows: two soft dashes, high and worried, which is most of the joke.
    const brow = d => svg('path', {
        'd': d,
        'stroke': '#000000',
        'stroke-width': '1.6',
        'stroke-linecap': 'round',
        'fill': 'none',
        'stroke-opacity': '0.45'
    }, block.svgFace_);
    brow('M24.4-9.6c1.6-1.4 4.6-2 7.2-1.4');
    brow('M64-9.6c-1.6-1.4-4.6-2-7.2-1.4');

    const shutEye = d => svg('path', {
        'd': d,
        'stroke': '#000000',
        'stroke-width': '1.6',
        'stroke-linecap': 'round',
        'fill': 'none',
        'stroke-opacity': '0'
    }, block.svgFace_);
    block.catPath_.svgFace.closedEye = shutEye('M26.6-4.4c1.6 1.5 4.4 1.5 6 0');
    block.catPath_.svgFace.closedEye2 = shutEye('M55.4-4.4c1.6 1.5 4.4 1.5 6 0');

    // Eyes sit closer together and lower than a cat's, which is what makes
    // the face read as a shiba rather than a cat with odd ears.
    const openEye = cx => svg('circle', {
        'cx': cx,
        'cy': '-4.4',
        'r': '2.7',
        'fill-opacity': '0.6'
    }, block.svgFace_);
    block.catPath_.svgFace.eye = openEye('58.4');
    block.catPath_.svgFace.eye2 = openEye('29.6');

    // Nose, then the smirk under it.
    svg('path', {
        'd': 'M41.2-4.6h6c0.9,0 1.5,0.9 1.1,1.7l-3,3.2c-0.5,0.5 -1.2,0.5 -1.6,0l-3-3.2' +
            'C39.7-3.7 40.3-4.6 41.2-4.6z',
        'fill-opacity': '0.75'
    }, block.svgFace_);
    svg('path', {
        'd': 'M44.2 0.3c-1.8 0-3.2-1-3.8-2.3M44.2 0.3c1.8 0 3.2-1 3.8-2.3',
        'stroke': '#000000',
        'stroke-width': '1.4',
        'stroke-linecap': 'round',
        'fill': 'none',
        'stroke-opacity': '0.55'
    }, block.svgFace_);

    // The ears keep the cat's shape — a shiba's are pricked too — but lose
    // the pink.
    block.catPath_.ear.setAttribute(
        'd',
        'M73.1-15.6c1.7-4.2,4.5-9.1,5.8-8.5' +
        'c1.6,0.8,5.4,7.9,5,15.4c0,0.6-0.7,0.7-1.1,0.5c-3-1.6-6.4-2.8-8.6-3.6' +
        'C72.8-12.3,72.4-13.7,73.1-15.6z'
    );
    block.catPath_.ear.setAttribute('fill', EAR_INSIDE);

    block.catPath_.ear2.setAttribute(
        'd',
        'M22.4-15.6c-1.7-4.2-4.5-9.1-5.8-8.5' +
        'c-1.6,0.8-5.4,7.9-5,15.4c0,0.6,0.7,0.7,1.1,0.5c3-1.6,6.4-2.8,8.6-3.6' +
        'C22.8-12.3,23.2-13.7,22.4-15.6z'
    );
    block.catPath_.ear2.setAttribute('fill', EAR_INSIDE);
};

// Every workspace on the page, which matters because an empty project has no
// blocks on the canvas at all — every cat you can see is in the palette, and
// the palette is a workspace of its own.
const allWorkspaces = Blockly => {
    const db = Blockly.Workspace && Blockly.Workspace.WorkspaceDB_;
    if (db) return Object.values(db);
    const main = Blockly.getMainWorkspace && Blockly.getMainWorkspace();
    return main ? [main] : [];
};

const turnCatsIntoDoges = () => {
    if (doged || !LazyScratchBlocks.isLoaded()) return;
    const Blockly = LazyScratchBlocks.get();

    const hats = allWorkspaces(Blockly)
        .flatMap(workspace => {
            try {
                return workspace.getAllBlocks(false);
            } catch (e) {
                return [];
            }
        })
        .filter(block => block.catPath_ && block.startHat_ && block.svgFace_);

    // No cat faces anywhere means Cat Blocks is off, and there is nothing to
    // turn into anything.
    if (!hats.length) return;
    doged = true;

    // Patched through a real block rather than through Blockly.BlockSvg: the
    // editor has more than one copy of Blockly loaded, and the addon patched
    // whichever one the workspace actually uses. Going via a block that is on
    // screen cannot pick the wrong one.
    const prototype = Object.getPrototypeOf(hats[0]);
    prototype.renderCatFace_ = function () {
        this.catPath_.svgFace.setAttribute('fill', '#000000');
        drawDogeFace(this, Blockly);
    };

    // The face is only drawn once per block, when it is empty, so the ones
    // already on screen have to be emptied and asked again.
    for (const block of hats) {
        while (block.svgFace_.firstChild) block.svgFace_.removeChild(block.svgFace_.firstChild);
        try {
            block.renderCatFace_();
        } catch (e) {
            // One block refusing to redraw is not worth breaking the editor
            // over, least of all for a joke.
        }
    }
};

/**
 * Start listening for the code. Safe to call more than once.
 */
export const installDogeEasterEgg = () => {
    if (installed || typeof document === 'undefined') return;
    installed = true;

    // The last few keys, compared against the code as a whole. Counting
    // forwards with an index looks simpler but gets a failed attempt wrong:
    // "up up down down left right left up" leaves the counter part-way
    // through, and the next honest attempt then fails for no visible reason.
    const recent = [];
    // Listened for on the way down rather than on the way up. Blockly moves
    // the selected block with the arrow keys and stops the event there, and a
    // running project is handed them too, so by the time a key reaches
    // document it may already have been swallowed — which is why this worked
    // on an empty page and not once you had clicked into the workspace.
    window.addEventListener('keydown', e => {
        // Arrow keys mean something else while typing, and nudging a block
        // around the workspace with them should not count either.
        const el = e.target;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
            recent.length = 0;
            return;
        }
        recent.push(e.key);
        if (recent.length > SEQUENCE.length) recent.shift();
        if (recent.length === SEQUENCE.length && recent.every((key, i) => key === SEQUENCE[i])) {
            recent.length = 0;
            turnCatsIntoDoges();
        }
    }, true);
};
