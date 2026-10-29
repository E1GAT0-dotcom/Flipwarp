// Idle pause: a project left running with nobody using it is paused, so a
// computer with several Claude chats open is not running every game at once.
//
// "Nobody" means no request from Claude, none still being worked on, and no
// key, click or scroll on the page for IDLE_MS. It freezes the project the
// way the step buttons do (gameplay.js), so its timers do not jump when it
// carries on. The next request from Claude, or any key or click on the page,
// carries on. A freeze Claude asked for itself is left alone.

import {isFrozen, setFrozen, onFrozenChanged} from './gameplay.js';
import {record} from './mcp-live.js';

// Longer than the longest wait the server does between requests (60s).
// ?idle=<seconds> in the address changes it, for testing.
const IDLE_MS = (() => {
    try {
        const seconds = Number(new URLSearchParams(location.search).get('idle'));
        if (seconds > 0) return seconds * 1000;
    } catch (e) {
        // no address to read
    }
    return 90000;
})();
const CHECK_MS = Math.min(5000, IDLE_MS / 2);

let lastActivity = Date.now();
let inFlight = 0;
let idlePaused = false;

const wake = () => {
    if (!idlePaused) return;
    idlePaused = false;
    if (isFrozen()) setFrozen(false);
    record({icon: '▶', text: 'carried on', tone: 'dim'});
};

/** A request from Claude has arrived: carry on if idle-paused. */
export const requestStarted = () => {
    inFlight++;
    lastActivity = Date.now();
    wake();
};

/** A request from Claude has been answered. */
export const requestFinished = () => {
    inFlight = Math.max(0, inFlight - 1);
    lastActivity = Date.now();
};

/**
 * @param {object} vm the VM
 */
export const installIdlePause = vm => {
    const onInput = () => {
        lastActivity = Date.now();
        wake();
    };
    for (const type of ['pointerdown', 'keydown', 'wheel']) {
        document.addEventListener(type, onInput, true);
    }
    // Anything else carrying on (the green flag, the step buttons, coming
    // back to a tab with "Pause off-screen") means this pause is over.
    onFrozenChanged(frozen => {
        if (!frozen) idlePaused = false;
    });
    setInterval(() => {
        if (idlePaused || inFlight || isFrozen()) return;
        if (Date.now() - lastActivity < IDLE_MS) return;
        // Nothing running is nothing to save.
        if (!vm.runtime.threads.length) return;
        idlePaused = true;
        setFrozen(true);
        record({icon: '⏸', text: 'paused to save power while nothing is happening. Click or press a key to carry on'});
    }, CHECK_MS);
};
