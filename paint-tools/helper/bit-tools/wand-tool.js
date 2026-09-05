import paper from '@turbowarp/paper';
import Modes from '../../lib/modes';

import {getRaster} from '../layer';
import {commitSelectionToBitmap} from '../bitmap';
import {ART_BOARD_WIDTH, ART_BOARD_HEIGHT} from '../view';
import {clearSelection} from '../selection';
import {readBoard, liftMask} from './masked-selection';

import BoundingBoxTool from '../selection-tools/bounding-box-tool';
import NudgeTool from '../selection-tools/nudge-tool';

/**
 * The magic wand: click a colour and pick up everything that colour reaches.
 *
 * Once something is picked up it is an ordinary bitmap selection, so moving,
 * scaling, copying and deleting it are all the work of the bounding box tool
 * that the rectangular select already uses.
 */
class WandTool extends paper.Tool {
    static get TOLERANCE () {
        return 2;
    }
    /**
     * @param {function} setSelectedItems Callback to set the selection in Redux
     * @param {function} clearSelectedItems Callback to clear the selection in Redux
     * @param {function} setCursor Callback to set the visible mouse cursor
     * @param {!function} onUpdateImage Callback for when the image visibly changes
     * @param {!function} getTolerance Reads the current tolerance, 0 to 100
     * @param {!function} getContiguous Reads whether to stay within one patch of colour
     */
    constructor (setSelectedItems, clearSelectedItems, setCursor, onUpdateImage, getTolerance, getContiguous) {
        super();
        this.onUpdateImage = onUpdateImage;
        this.getTolerance = getTolerance;
        this.getContiguous = getContiguous;
        this.setSelectedItems = setSelectedItems;
        this.clearSelectedItems = clearSelectedItems;
        this.boundingBoxTool = new BoundingBoxTool(
            Modes.BIT_WAND,
            setSelectedItems,
            clearSelectedItems,
            setCursor,
            onUpdateImage
        );
        const nudgeTool = new NudgeTool(Modes.BIT_WAND, this.boundingBoxTool, onUpdateImage);
        this.selection = null;
        // What the wand chose last time, kept so that shift-clicking can add to
        // it. The pixels themselves are no longer in the drawing by then, so
        // adding has to put them back, widen the mask and lift the whole thing
        // again rather than lifting a second piece alongside.
        this.mask = null;
        this.active = false;

        this.onMouseDown = this.handleMouseDown;
        this.onMouseDrag = this.handleMouseDrag;
        this.onMouseMove = this.handleMouseMove;
        this.onMouseUp = this.handleMouseUp;
        this.onKeyUp = nudgeTool.onKeyUp;
        this.onKeyDown = nudgeTool.onKeyDown;

        this.boundingBoxTool.setSelectionBounds();
    }
    onSelectionChanged (selectedItems) {
        this.boundingBoxTool.onSelectionChanged(selectedItems);
        if (this.selection && this.selection.parent && !this.selection.selected) {
            this.commitSelection();
        }
        if ((!this.selection || !this.selection.parent) &&
                selectedItems && selectedItems.length === 1 && selectedItems[0] instanceof paper.Raster) {
            this.selection = selectedItems[0];
            this.mask = null;
        }
    }
    getHitOptions () {
        return {
            segments: true,
            stroke: true,
            curves: true,
            fill: true,
            guide: false,
            tolerance: WandTool.TOLERANCE / paper.view.zoom,
            match: hitResult => {
                if (!hitResult.item.data || !hitResult.item.data.isHelperItem) return true;
                return hitResult.item.data.isScaleHandle || hitResult.item.data.isRotHandle;
            }
        };
    }
    handleMouseDown (event) {
        if (event.event.button > 0) return;
        this.active = true;

        // A click on the selection already on screen means move it, not start
        // again — same rule the rectangular select follows.
        if (this.boundingBoxTool.onMouseDown(
            event,
            event.modifiers.alt,
            event.modifiers.shift,
            false /* doubleClicked */,
            this.getHitOptions())) {
            this.wandMode = false;
            return;
        }

        this.wandMode = true;
        const adding = event.modifiers.shift && this.mask;
        // Put the old selection back before looking at the drawing, or the
        // wand would search a picture with a hole in it where the selection
        // used to be.
        const previous = adding ? this.mask : null;
        this.commitSelection();
        if (!adding) {
            clearSelection(this.clearSelectedItems);
            this.mask = null;
        }

        const grown = this.chooseFrom(event.point, previous);
        if (!grown) return;
        this.mask = grown;
        if (liftMask(grown, this.setSelectedItems)) {
            this.selection = paper.project.activeLayer.children
                .find(child => child instanceof paper.Raster && child.selected) || null;
        } else {
            this.mask = null;
        }
    }
    /**
     * Work out which pixels the wand takes, given where it was clicked.
     *
     * @param {paper.Point} point Where on the board the click landed.
     * @param {?Uint8Array} previous A mask to add to, when shift is held.
     * @return {?Uint8Array} The new mask, or null if the click chose nothing.
     */
    chooseFrom (point, previous) {
        const x = Math.floor(point.x);
        const y = Math.floor(point.y);
        if (x < 0 || y < 0 || x >= ART_BOARD_WIDTH || y >= ART_BOARD_HEIGHT) return null;

        const board = readBoard();
        const data = board.data;
        const start = ((y * ART_BOARD_WIDTH) + x) * 4;
        // Clicking nothing chooses nothing. A wand that picked up the empty
        // space around a drawing would select almost the whole board and be
        // useless to move.
        if (data[start + 3] === 0) return null;

        const mask = previous ? Uint8Array.from(previous) : new Uint8Array(ART_BOARD_WIDTH * ART_BOARD_HEIGHT);
        // Tolerance runs 0 to 100 in the toolbar; here it is a distance
        // between two colours, so 100 has to reach right across the range.
        const limit = (this.getTolerance() / 100) * 255;
        const target = [data[start], data[start + 1], data[start + 2], data[start + 3]];

        const alike = index => {
            const at = index * 4;
            const a = data[at + 3];
            const ta = target[3];
            // A transparent pixel has no colour worth comparing, only its
            // transparency, so premultiply before measuring: otherwise the
            // leftover red in a cleared pixel counts against it.
            const dr = ((data[at] * a) - (target[0] * ta)) / 255;
            const dg = ((data[at + 1] * a) - (target[1] * ta)) / 255;
            const db = ((data[at + 2] * a) - (target[2] * ta)) / 255;
            const da = a - ta;
            return Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db), Math.abs(da)) <= limit;
        };

        if (!this.getContiguous()) {
            for (let i = 0; i < mask.length; i++) {
                if (alike(i)) mask[i] = 1;
            }
            return mask;
        }

        // Scanline flood: walk a whole run of matching pixels at once and only
        // push the rows above and below, which is a great deal less pushing
        // than one entry per pixel on a board this size.
        const seen = new Uint8Array(mask.length);
        const stack = [[x, y]];
        while (stack.length) {
            const [sx, sy] = stack.pop();
            let left = sx;
            const row = sy * ART_BOARD_WIDTH;
            while (left > 0 && !seen[row + left - 1] && alike(row + left - 1)) left--;
            let right = sx;
            while (right < ART_BOARD_WIDTH - 1 && !seen[row + right + 1] && alike(row + right + 1)) right++;
            for (let i = left; i <= right; i++) {
                seen[row + i] = 1;
                mask[row + i] = 1;
            }
            for (const nextY of [sy - 1, sy + 1]) {
                if (nextY < 0 || nextY >= ART_BOARD_HEIGHT) continue;
                const nextRow = nextY * ART_BOARD_WIDTH;
                let run = false;
                for (let i = left; i <= right; i++) {
                    const ok = !seen[nextRow + i] && alike(nextRow + i);
                    if (ok && !run) {
                        stack.push([i, nextY]);
                        run = true;
                    } else if (!ok) {
                        run = false;
                    }
                }
            }
        }
        return mask;
    }
    handleMouseDrag (event) {
        if (event.event.button > 0 || !this.active || this.wandMode) return;
        this.boundingBoxTool.onMouseDrag(event);
    }
    handleMouseMove (event) {
        this.boundingBoxTool.onMouseMove(event, this.getHitOptions());
    }
    handleMouseUp (event) {
        if (event.event.button > 0 || !this.active) return;
        if (!this.wandMode) this.boundingBoxTool.onMouseUp(event);
        this.wandMode = false;
        this.active = false;
    }
    commitSelection () {
        if (!this.selection || !this.selection.parent) return;
        commitSelectionToBitmap(this.selection, getRaster());
        this.selection.remove();
        this.selection = null;
        this.onUpdateImage();
    }
    deactivateTool () {
        this.commitSelection();
        this.boundingBoxTool.deactivateTool();
        this.boundingBoxTool = null;
        this.mask = null;
    }
}

export default WandTool;
