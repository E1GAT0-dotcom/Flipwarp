/**
 * Which kind of pointer the person is actually using.
 *
 * Not which kinds the device has. A laptop with a touchscreen has both, and
 * deciding by what the hardware can do would hand someone with a mouse in
 * their hand a set of finger-sized buttons for the rest of the session. So
 * this watches what they last touched the screen or the mouse with, and says
 * so on the <html> element as data-input="touch" or data-input="mouse". Every
 * rule that makes something bigger hangs off that, and it changes back the
 * moment they pick the mouse up again.
 *
 * The first answer, before anyone has touched anything, comes from the screen
 * itself: a phone should not have to be tapped once before its buttons are the
 * right size.
 */

const ROOT = typeof document === 'undefined' ? null : document.documentElement;

let current = null;
const listeners = new Set();

/**
 * @return {string} 'touch' or 'mouse'.
 */
const inputKind = () => current || 'mouse';

/**
 * @return {boolean} Whether the last thing used was a finger or a pen.
 */
const isTouch = () => current === 'touch';

const announce = kind => {
    if (kind === current) return;
    current = kind;
    if (ROOT) ROOT.dataset.input = kind;
    for (const listener of listeners) {
        try {
            listener(kind);
        } catch (e) {
            // A listener that throws is its own problem, not everyone else's.
        }
    }
};

/**
 * Be told when the person switches between a finger and a mouse.
 * @param {function} listener Called with 'touch' or 'mouse'.
 * @return {function} Call it to stop being told.
 */
const onInputChanged = listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

let started = false;

/**
 * Start watching. Safe to call more than once.
 * @return {void}
 */
const watchInput = () => {
    if (started || typeof window === 'undefined') return;
    started = true;

    // The first answer, before anything has been touched. A phone has a coarse
    // pointer and no fine one; a laptop with a touchscreen has both, and it
    // starts as a mouse because that is what someone sitting at one is most
    // likely holding. One tap changes its mind.
    const ask = query => Boolean(window.matchMedia && window.matchMedia(query).matches);
    announce(ask('(pointer: coarse)') && !ask('(any-pointer: fine)') ? 'touch' : 'mouse');

    if (window.PointerEvent) {
        // The easy case: the event says which it was.
        const sawPointer = e => {
            announce(e.pointerType === 'mouse' ? 'mouse' : 'touch');
        };
        window.addEventListener('pointerdown', sawPointer, {capture: true, passive: true});
        // Moving the mouse counts as picking it up, even before a click —
        // otherwise the buttons stay finger-sized until the first thing is
        // pressed, which is the moment they are most in the way.
        window.addEventListener('pointermove', sawPointer, {capture: true, passive: true});
        return;
    }

    // Without pointer events a touch is followed by a synthetic mouse event a
    // moment later, describing the same tap. Taking that at face value would
    // flip straight back to mouse on every single tap, so mouse events are
    // ignored for a breath after a real touch.
    let lastTouch = 0;
    window.addEventListener('touchstart', () => {
        lastTouch = Date.now();
        announce('touch');
    }, {capture: true, passive: true});
    const sawMouse = () => {
        if (Date.now() - lastTouch < 800) return;
        announce('mouse');
    };
    window.addEventListener('mousedown', sawMouse, {capture: true, passive: true});
    window.addEventListener('mousemove', sawMouse, {capture: true, passive: true});
};

export {
    watchInput,
    isTouch,
    inputKind,
    onInputChanged
};
