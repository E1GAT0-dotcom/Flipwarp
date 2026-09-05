// The small amount of work a gameplay setting needs doing at the moment it
// changes, rather than the next time the project asks.
//
// Most of them need nothing: the wrappers in gameplay.js read the setting on
// every call, so a switch is in effect the instant it is flipped. These three
// are the exceptions — one is a stylesheet rather than a wrapper, one has to
// ask the renderer to work its size out again, and one has to let go of a
// project it is holding frozen when the reason for holding it is switched
// off.

import {getSettings, onSettingsChanged} from './settings.js';
import {refreshRenderScale, isFrozen, setFrozen} from './gameplay.js';

let last = null;

const apply = settings => {
    // Read by the stage's own stylesheet. On the root element rather than the
    // stage so that it also covers full screen, where the stage is somewhere
    // else in the page entirely.
    document.documentElement.dataset.hidePointer = settings.hidePointer ? 'true' : 'false';

    if (!last || last.renderScale !== settings.renderScale) {
        refreshRenderScale();
    }

    // Turning off "pause off-screen" while the project is being held frozen
    // by it would otherwise leave the project stopped with nothing on screen
    // to say why or any way to start it again short of the green flag.
    if (last && last.pauseOffScreen && !settings.pauseOffScreen && isFrozen()) {
        setFrozen(false);
    }

    last = settings;
};

/**
 * Watch the settings and keep the page in step with them.
 */
export const watchGameplaySettings = () => {
    apply(getSettings());
    onSettingsChanged(apply);
};
