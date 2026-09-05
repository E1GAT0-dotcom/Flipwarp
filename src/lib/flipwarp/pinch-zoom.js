/**
 * Pinch to zoom the block workspace.
 *
 * Blockly can zoom — the buttons in the corner and ctrl-scroll both do it —
 * but it has no idea what two fingers moving apart means, so on a tablet the
 * only way to make blocks bigger is to hunt for a small round button. This
 * adds the gesture, from outside: it listens on the element Blockly was
 * injected into and calls the zoom Blockly already has.
 *
 * Nothing here touches scratch-blocks itself, which is why it can be a
 * separate file rather than another patch to a dependency.
 */

// How far the fingers have to move before it counts as a pinch rather than a
// two-fingered scroll. Without it, resting a second finger on the glass while
// dragging jumps the zoom.
const SLOP = 12;

const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const middle = (a, b) => ({
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2
});

/**
 * Let two fingers zoom a workspace.
 *
 * @param {HTMLElement} element The element Blockly was injected into.
 * @param {object} workspace The Blockly workspace inside it.
 * @param {object} Blockly The scratch-blocks namespace, for its coordinate maths.
 * @return {function} Call it to stop listening.
 */
const installPinchZoom = (element, workspace, Blockly) => {
    if (!element || !workspace) return () => {};

    let pinching = false;
    let startGap = 0;
    let lastScale = 1;

    const touchesOf = e => (e.touches && e.touches.length >= 2 ?
        [e.touches[0], e.touches[1]] : null);

    const onStart = e => {
        const two = touchesOf(e);
        if (!two) return;
        // Whatever Blockly thought was happening — dragging a block, drawing a
        // selection — a second finger means it was wrong.
        if (workspace.currentGesture_) workspace.currentGesture_.cancel();
        startGap = distance(two[0], two[1]);
        lastScale = workspace.scale;
        pinching = startGap > 0;
    };

    const onMove = e => {
        const two = touchesOf(e);
        if (!pinching || !two) return;
        const gap = distance(two[0], two[1]);
        if (Math.abs(gap - startGap) < SLOP) return;
        e.preventDefault();

        const wanted = lastScale * (gap / startGap);
        const speed = workspace.options.zoomOptions.scaleSpeed;
        // Blockly's zoom is worded in clicks of the zoom button rather than in
        // scales, so the ratio the fingers asked for has to be turned back
        // into a number of clicks.
        const clicks = Math.log(wanted / workspace.scale) / Math.log(speed);
        if (!isFinite(clicks) || clicks === 0) return;

        const at = middle(two[0], two[1]);
        const point = Blockly.utils.mouseToSvg(
            at, workspace.getParentSvg(), workspace.getInverseScreenCTM());
        workspace.zoom(point.x, point.y, clicks);
    };

    const onEnd = e => {
        if (e.touches && e.touches.length >= 2) return;
        pinching = false;
    };

    // Not passive: a pinch has to be able to stop the browser zooming the
    // whole page instead, which is the one thing that would make this useless.
    element.addEventListener('touchstart', onStart, {passive: true});
    element.addEventListener('touchmove', onMove, {passive: false});
    element.addEventListener('touchend', onEnd, {passive: true});
    element.addEventListener('touchcancel', onEnd, {passive: true});

    return () => {
        element.removeEventListener('touchstart', onStart);
        element.removeEventListener('touchmove', onMove);
        element.removeEventListener('touchend', onEnd);
        element.removeEventListener('touchcancel', onEnd);
    };
};

export {installPinchZoom};
