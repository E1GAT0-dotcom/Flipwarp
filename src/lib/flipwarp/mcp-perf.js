// The speed report, for flipwarp-mcp: why a game is laggy, measured rather
// than guessed.
//
// It runs real frames here and now, one after another, the way step_frames
// does, so a hidden tab measures the same as a visible one. Each frame is
// timed, and so is every pass of every script (Sequencer.stepThread, which
// compiled scripts go through too) and the drawing. The project runs on by
// those frames, and is left paused or running as it was.

import {isFrozen, setFrozen, stepOneFrame} from './gameplay.js';

const now = () => performance.now();

// Put a timing wrapper on a method for the length of the measurement. The
// returned function takes it off again, leaving the object as it was (a
// method that came from the prototype is not left behind as an own copy).
const wrap = (object, name, wrapper) => {
    const own = Object.prototype.hasOwnProperty.call(object, name);
    const real = object[name];
    object[name] = wrapper(real);
    return () => {
        if (own) object[name] = real;
        else delete object[name];
    };
};

/**
 * @param {function} scriptName (target, topBlockId) -> a script's name, from the bridge
 * @returns {object} the speed requests
 */
export const perfMethods = scriptName => ({
    performance: (vm, {frames = 60}) => {
        const runtime = vm.runtime;
        const count = Math.max(10, Math.min(300, Math.floor(frames)));
        const sequencer = runtime.sequencer;
        const renderer = runtime.renderer;

        // Per script: the original sprite and the hat block, so all of a
        // sprite's clones running the same script add up together.
        const scripts = new Map();
        let passesThisFrame = new Map();
        const undo = [];
        undo.push(wrap(sequencer, 'stepThread', realStepThread => thread => {
            const started = now();
            try {
                return realStepThread.call(sequencer, thread);
            } finally {
                const ms = now() - started;
                const target = thread.target;
                const original = target && target.sprite ? target.sprite.clones[0] : target;
                const key = `${original ? original.id : '?'} ${thread.topBlock}`;
                let s = scripts.get(key);
                if (!s) {
                    s = {target: original, topBlock: thread.topBlock, ms: 0, passes: 0, maxPasses: 0, copies: 0};
                    scripts.set(key, s);
                }
                s.ms += ms;
                s.passes++;
                const passes = (passesThisFrame.get(thread) || 0) + 1;
                passesThisFrame.set(thread, passes);
                s.maxPasses = Math.max(s.maxPasses, passes);
            }
        }));
        // The drawing. The editor leaves it out while the tab is hidden.
        let drawMs = 0;
        let draws = 0;
        if (renderer) {
            undo.push(wrap(renderer, 'draw', realDraw => (...args) => {
                const started = now();
                try {
                    return realDraw.apply(renderer, args);
                } finally {
                    drawMs += now() - started;
                    draws++;
                }
            }));
        }
        // The editor keeping up: the sprite panel, the sprite list and the
        // variable displays redraw from these whenever something they show
        // changes. Not part of the game, and not there in a packaged game or
        // the player view, but it is time the editor's frames take.
        let editorMs = 0;
        undo.push(wrap(runtime, 'emit', realEmit => (event, ...args) => {
            if (event !== 'TARGETS_UPDATE' && event !== 'MONITORS_UPDATE') {
                return realEmit.call(runtime, event, ...args);
            }
            const started = now();
            try {
                return realEmit.call(runtime, event, ...args);
            } finally {
                editorMs += now() - started;
            }
        }));

        const wasFrozen = isFrozen();
        const costs = [];
        try {
            for (let i = 0; i < count; i++) {
                passesThisFrame = new Map();
                const started = now();
                stepOneFrame();
                runtime._step();
                costs.push(now() - started);
                // How many clones of each script ran at once.
                const copies = new Map();
                for (const thread of passesThisFrame.keys()) {
                    const original = thread.target && thread.target.sprite ? thread.target.sprite.clones[0] :
                        thread.target;
                    const key = `${original ? original.id : '?'} ${thread.topBlock}`;
                    copies.set(key, (copies.get(key) || 0) + 1);
                }
                for (const [key, n] of copies) {
                    const s = scripts.get(key);
                    if (s) s.copies = Math.max(s.copies, n);
                }
            }
        } finally {
            for (const fn of undo.reverse()) fn();
            if (!wasFrozen) setFrozen(false);
        }

        const round = n => Math.round(n * 100) / 100;
        const total = costs.reduce((a, b) => a + b, 0);
        const budget = runtime.currentStepTime;
        const top = [...scripts.values()]
            .sort((a, b) => b.ms - a.ms)
            .slice(0, 8)
            .map(s => ({
                sprite: s.target ? (s.target.isStage ? 'Stage' : s.target.getName()) : '?',
                script: s.target ? scriptName(s.target, s.topBlock) : 'a script',
                msPerFrame: round(s.ms / count),
                share: total ? Math.round((s.ms / total) * 100) : 0,
                passesPerFrame: round(s.passes / count),
                mostPassesInAFrame: s.maxPasses,
                copies: s.copies
            }));
        const clones = runtime.targets.filter(t => t.isSprite && !t.isOriginal).length;
        return {
            frames: count,
            framerate: Math.round(1000 / budget),
            budgetMs: round(budget),
            averageMs: round(total / count),
            slowestMs: round(Math.max(...costs)),
            framesOverBudget: costs.filter(c => c > budget).length,
            scriptsMsPerFrame: round([...scripts.values()].reduce((sum, s) => sum + s.ms, 0) / count),
            drawMsPerFrame: round(drawMs / count),
            drawn: draws > 0,
            hidden: document.hidden,
            interpolation: !!runtime.interpolationEnabled,
            editorMsPerFrame: round(editorMs / count),
            scripts: top,
            clones,
            cloneLimit: runtime.runtimeOptions && runtime.runtimeOptions.maxClones,
            threadsRunning: runtime.threads.length,
            compiled: !!(runtime.compilerOptions && runtime.compilerOptions.enabled),
            paused: isFrozen()
        };
    }
});
