import paper from '@turbowarp/paper';
import Modes from '../../lib/modes';

import {getRaster, getGuideLayer} from '../layer';
import {commitSelectionToBitmap} from '../bitmap';
import {ART_BOARD_WIDTH, ART_BOARD_HEIGHT} from '../view';
import {clearSelection} from '../selection';
import {readBoard, liftMask} from './masked-selection';

import BoundingBoxTool from '../selection-tools/bounding-box-tool';
import NudgeTool from '../selection-tools/nudge-tool';

/**
 * The lasso: draw a loop around the part you want and pick that part up.
 *
 * The loop closes itself, so you do not have to come back to exactly where you
 * started. What is picked up is the drawing inside the loop and nothing else —
 * the empty space inside is left alone, which is how the rectangular select
 * already behaves and means the selection hugs what you can see rather than
 * carrying a cloud of nothing around with it.
 */
class LassoTool extends paper.Tool {
    static get TOLERANCE () {
        return 2;
    }
    /**
     * @param {function} setSelectedItems Callback to set the selection in Redux
     * @param {function} clearSelectedItems Callback to clear the selection in Redux
     * @param {function} setCursor Callback to set the visible mouse cursor
     * @param {!function} onUpdateImage Callback for when the image visibly changes
     */
    constructor (setSelectedItems, clearSelectedItems, setCursor, onUpdateImage) {
        super();
        this.onUpdateImage = onUpdateImage;
        this.setSelectedItems = setSelectedItems;
        this.clearSelectedItems = clearSelectedItems;
        this.boundingBoxTool = new BoundingBoxTool(
            Modes.BIT_LASSO,
            setSelectedItems,
            clearSelectedItems,
            setCursor,
            onUpdateImage
        );
        const nudgeTool = new NudgeTool(Modes.BIT_LASSO, this.boundingBoxTool, onUpdateImage);
        this.selection = null;
        this.loop = null;
        this.lassoMode = false;
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
        }
    }
    getHitOptions () {
        return {
            segments: true,
            stroke: true,
            curves: true,
            fill: true,
            guide: false,
            tolerance: LassoTool.TOLERANCE / paper.view.zoom,
            match: hitResult => {
                if (!hitResult.item.data || !hitResult.item.data.isHelperItem) return true;
                return hitResult.item.data.isScaleHandle || hitResult.item.data.isRotHandle;
            }
        };
    }
    handleMouseDown (event) {
        if (event.event.button > 0) return;
        this.active = true;

        if (this.boundingBoxTool.onMouseDown(
            event,
            event.modifiers.alt,
            event.modifiers.shift,
            false /* doubleClicked */,
            this.getHitOptions())) {
            this.lassoMode = false;
            return;
        }

        this.lassoMode = true;
        this.commitSelection();
        clearSelection(this.clearSelectedItems);
        this.startLoop(event.point);
    }
    startLoop (point) {
        this.endLoop();
        // A guide item, so that undo, export and the drawing itself never see
        // it — it is a line on the glass, not part of the picture.
        this.loop = new paper.Path({
            segments: [point],
            closed: false,
            strokeColor: '#4d97ff',
            strokeWidth: 1 / paper.view.zoom,
            dashArray: [4 / paper.view.zoom, 4 / paper.view.zoom],
            fillColor: null,
            guide: true
        });
        this.loop.parent = getGuideLayer();
    }
    endLoop () {
        if (this.loop) {
            this.loop.remove();
            this.loop = null;
        }
    }
    handleMouseDrag (event) {
        if (event.event.button > 0 || !this.active) return;
        if (!this.lassoMode) {
            this.boundingBoxTool.onMouseDrag(event);
            return;
        }
        if (this.loop) this.loop.add(event.point);
    }
    handleMouseMove (event) {
        this.boundingBoxTool.onMouseMove(event, this.getHitOptions());
    }
    handleMouseUp (event) {
        if (event.event.button > 0 || !this.active) return;
        if (this.lassoMode) {
            this.finishLoop();
        } else {
            this.boundingBoxTool.onMouseUp(event);
        }
        this.lassoMode = false;
        this.active = false;
    }
    finishLoop () {
        const loop = this.loop;
        this.loop = null;
        if (!loop) return;
        const points = loop.segments.map(segment => segment.point);
        loop.remove();
        // Two points is a line, not a loop.
        if (points.length < 3) return;

        const mask = this.maskFrom(points);
        if (!mask) return;
        if (liftMask(mask, this.setSelectedItems)) {
            this.selection = paper.project.activeLayer.children
                .find(child => child instanceof paper.Raster && child.selected) || null;
        }
    }
    /**
     * Which pixels the loop encloses, and are actually drawn on.
     *
     * The loop is filled into a canvas of its own rather than each pixel being
     * asked whether the path contains it: the browser fills a polygon in one
     * step, and asking three quarters of a million times takes long enough to
     * be felt.
     *
     * @param {Array<paper.Point>} points The path the mouse took.
     * @return {?Uint8Array} One byte per pixel, or null if nothing is enclosed.
     */
    maskFrom (points) {
        const canvas = document.createElement('canvas');
        canvas.width = ART_BOARD_WIDTH;
        canvas.height = ART_BOARD_HEIGHT;
        const context = canvas.getContext('2d');
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            context.lineTo(points[i].x, points[i].y);
        }
        context.closePath();
        context.fillStyle = '#fff';
        context.fill();

        const inside = context.getImageData(0, 0, ART_BOARD_WIDTH, ART_BOARD_HEIGHT).data;
        const drawn = readBoard().data;
        const mask = new Uint8Array(ART_BOARD_WIDTH * ART_BOARD_HEIGHT);
        let any = false;
        for (let i = 0; i < mask.length; i++) {
            // Half-covered edge pixels count as in, which keeps the edge of the
            // loop where it looks like it is rather than a pixel inside it.
            if (inside[(i * 4) + 3] > 127 && drawn[(i * 4) + 3] > 0) {
                mask[i] = 1;
                any = true;
            }
        }
        return any ? mask : null;
    }
    commitSelection () {
        if (!this.selection || !this.selection.parent) return;
        commitSelectionToBitmap(this.selection, getRaster());
        this.selection.remove();
        this.selection = null;
        this.onUpdateImage();
    }
    deactivateTool () {
        this.endLoop();
        this.commitSelection();
        this.boundingBoxTool.deactivateTool();
        this.boundingBoxTool = null;
    }
}

export default LassoTool;
