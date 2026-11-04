// Watching Claude work, for flipwarp-mcp: the editor as something to watch
// rather than something to work in. Only on the page with ?mcp.
//
//   - Watching layout: no block palette, no add buttons, code and drawings
//     that can be looked at but not dragged. "Take over" gives the person
//     the whole editor back (and tells Claude to wait); "Hand back" returns
//     it, and Claude is told what they changed.
//   - A header in the menu bar: which chat this is (its colour and its
//     game's name), the step of its plan, a progress bar for what it is
//     doing, Follow, Take over, Download, and a link to the control room.
//   - Follow: the editor goes where Claude is working (the sprite, the
//     Costumes or Sounds tab, a bigger stage while it plays), staying on each
//     view long enough to see, and stops following when the person looks
//     somewhere else themselves.
//   - Claude's cursor: a marker that moves to what it is working on.
//   - The tab's title and icon show the chat's state, so a row of tabs reads
//     as a dashboard.

import {onRipple} from './mcp-live.js';
import sharedAudioContext from '../audio/shared-audio-context.js';

const DWELL_MS = 1500;
const BIG_STAGE_MS = 6000;

let installed = false;
let vm = null;
let options = {};
let identity = {color: '#3a86ff', name: null, port: null, control: null};
let plan = null;
let connected = false;
let takenOver = false;
let following = true;
let lastBusy = 0;
let idlePausedFn = () => false;
let progressNow = null;
let progressTimer = null;

let header = null;
const parts = {};
let cursor = null;
let cursorTimer = null;
let favicon = null;
let lastIconKey = null;

// Following: the view Claude's latest request wants, and when the view last
// changed.
let wanted = null;
let lastSwitch = 0;
let switchTimer = null;
let bigStageTimer = null;
let stageBefore = null;
let programmatic = false;

const css = `
body.fw-watching .blocklyFlyout, body.fw-watching .blocklyFlyoutScrollbar, body.fw-watching .blocklyToolboxDiv,
body.fw-watching [class*="gui_extension-button-container"],
body.fw-watching [class*="action-menu_menu-container"],
body.fw-watching [class*="sprite-selector-item_delete-button"] { display: none !important; }
body.fw-watching .blocklyBlockCanvas, body.fw-watching .blocklyBubbleCanvas,
body.fw-watching [class*="paint-editor_editor-container"],
body.fw-watching [class*="sound-editor_editor-container"],
body.fw-watching [class*="sprite-info_sprite-info"] input { pointer-events: none !important; }
.fw-head { position: fixed; z-index: 600; top: 6px; right: 10px; max-width: min(760px, calc(100vw - 20px));
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 5px 8px 5px 10px;
  font: 12px/1.3 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #fff; background: rgba(17,18,26,0.92);
  border: 1px solid rgba(255,255,255,0.14);
  border-left: 5px solid var(--fw-chat, #3a86ff); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.35); }
.fw-head .fw-who { white-space: nowrap; }
.fw-head .fw-who b { font-size: 13px; }
.fw-head .fw-mid { flex: 1; min-width: 120px; display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
.fw-head .fw-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #c9cdd6; }
.fw-head .fw-track { height: 5px; border-radius: 3px; background: rgba(255,255,255,0.15); overflow: hidden; }
.fw-head .fw-fill { height: 100%; width: 0; background: var(--fw-chat, #3a86ff); transition: width 0.3s; }
.fw-head .fw-fill.fw-loose { width: 35% !important; animation: fw-slide 1.1s ease-in-out infinite alternate; }
@keyframes fw-slide { from { margin-left: 0; } to { margin-left: 65%; } }
.fw-head button, .fw-head a.fw-btn { font: inherit; color: #fff; background: rgba(255,255,255,0.1); border: 1px solid
  rgba(255,255,255,0.2); border-radius: 5px; padding: 3px 8px; cursor: pointer; white-space: nowrap;
  text-decoration: none; }
.fw-head button:hover, .fw-head a.fw-btn:hover { background: rgba(255,255,255,0.2); }
.fw-head button.fw-on { background: var(--fw-chat, #3a86ff); border-color: transparent; }
.fw-head button.fw-call { background: #ffbe0b; color: #11121a; border-color: transparent; }
.fw-head.fw-docked { position: static; flex: 0 1 auto; flex-wrap: nowrap; min-width: 0; max-width: none;
  align-self: center; margin-right: 8px; overflow: hidden; box-shadow: none; font-weight: normal; }
.fw-head.fw-docked .fw-who { min-width: 50px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
.fw-head.fw-docked .fw-pre { display: none; }
.fw-head.fw-docked .fw-mid { min-width: 60px; max-width: 220px; }
.fw-head.fw-docked button, .fw-head.fw-docked a.fw-btn { flex: none; padding: 3px 7px; }
@media (max-width: 1000px) { .fw-head.fw-docked .fw-extra { display: none !important; } }
.fw-making-room { display: none !important; }
.fw-cursor { position: fixed; z-index: 700; pointer-events: none; opacity: 0;
  transition: left 0.6s ease, top 0.6s ease, opacity 0.5s; }
.fw-cursor svg { display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5)); }
.fw-cursor span { position: absolute; left: 16px; top: 14px; padding: 1px 6px; border-radius: 8px; color: #fff;
  font: bold 11px "Helvetica Neue", Helvetica, Arial, sans-serif; background: var(--fw-chat, #3a86ff);
  white-space: nowrap; }
.fw-cursor.fw-shown { opacity: 1; }
body.fw-full .fw-cursor { display: none; }
body.fw-full .fw-head { position: fixed; top: auto; bottom: 8px; right: 8px;
  opacity: 0.85; max-width: min(340px, calc(100vw - 16px)); pointer-events: none; }
body.fw-full .fw-head button, body.fw-full .fw-head a.fw-btn { display: none; }
`;

const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (typeof text === 'string') e.textContent = text;
    return e;
};

// --- the plan, as words and as a fraction ----------------------------------------

const planLine = () => {
    if (!plan || !plan.steps || !plan.steps.length) return null;
    if (plan.status === 'done') return `Done: all ${plan.steps.length} steps`;
    const step = `Step ${plan.current} of ${plan.steps.length}: ${plan.steps[plan.current - 1]}`;
    return plan.status === 'needs-you' ? `✋ Waiting for you · ${step}` : step;
};

const planFraction = () => {
    if (!plan || !plan.steps || !plan.steps.length) return null;
    return plan.status === 'done' ? 1 : (plan.current - 1) / plan.steps.length;
};

// --- Claude's cursor -------------------------------------------------------------

const showCursorAt = (x, y) => {
    if (!cursor) return;
    cursor.style.left = `${Math.round(x)}px`;
    cursor.style.top = `${Math.round(y)}px`;
    cursor.classList.add('fw-shown');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => cursor.classList.remove('fw-shown'), 3500);
};

const pointAt = element => {
    const r = element.getBoundingClientRect();
    if (r.width) showCursorAt(r.left + (r.width / 2), r.top + (r.height / 2));
};

const spriteTile = name => [...document.querySelectorAll('[class*="sprite-selector-item_sprite-name"]')]
    .find(e => e.textContent === name && e.getBoundingClientRect().width > 0);

// --- the tab: title and icon -----------------------------------------------------

const tabState = () => {
    if (!connected) return {icon: '⚪', key: 'off'};
    if (takenOver) return {icon: '✋', key: 'you'};
    if (plan && plan.status === 'needs-you') return {icon: '✋', key: 'needs'};
    if (plan && plan.status === 'done') return {icon: '✓', key: 'done'};
    if (Date.now() - lastBusy < 8000) return {icon: '⏳', key: 'busy'};
    if (idlePausedFn()) return {icon: '⏸', key: 'paused'};
    return {icon: '💤', key: 'idle'};
};

const drawIcon = key => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = identity.color;
    g.beginPath();
    g.arc(16, 16, key === 'off' ? 10 : 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    if (key === 'busy') {
        g.beginPath();
        g.arc(16, 16, 7, -Math.PI / 2, Math.PI);
        g.stroke();
    } else if (key === 'done') {
        g.beginPath();
        g.moveTo(9, 16);
        g.lineTo(14, 21);
        g.lineTo(23, 11);
        g.stroke();
    } else if (key === 'needs' || key === 'you') {
        g.fillRect(14, 7, 4, 12);
        g.fillRect(14, 22, 4, 4);
    } else if (key === 'paused') {
        g.fillRect(10, 9, 4, 14);
        g.fillRect(18, 9, 4, 14);
    }
    return c.toDataURL('image/png');
};

const updateTab = () => {
    if (!installed) return;
    const state = tabState();
    const f = planFraction();
    const pct = f !== null && plan.status !== 'done' ? ` ${Math.round(f * 100)}%` : '';
    const title = `${state.icon}${pct} ${identity.name || 'Flipwarp'} · Claude`;
    if (document.title !== title) document.title = title;
    const key = `${state.key} ${identity.color}`;
    if (key !== lastIconKey) {
        lastIconKey = key;
        if (!favicon) {
            for (const old of document.querySelectorAll('link[rel~="icon"]')) old.remove();
            favicon = document.createElement('link');
            favicon.rel = 'icon';
            document.head.appendChild(favicon);
        }
        favicon.href = drawIcon(state.key);
    }
};

// --- the header ----------------------------------------------------------------

const renderHeader = () => {
    if (!header) return;
    header.style.setProperty('--fw-chat', identity.color);
    document.documentElement.style.setProperty('--fw-chat', identity.color);
    parts.who.textContent = '';
    parts.who.appendChild(el('span', 'fw-pre', takenOver ? 'You have the editor · ' : 'Claude is building '));
    parts.who.appendChild(el('b', '', identity.name || 'this game'));
    const p = progressNow;
    parts.label.textContent = (p && p.label) || planLine() || (connected ? 'Ready' : 'Waiting for Claude to connect');
    const fill = parts.fill;
    fill.classList.remove('fw-loose');
    if (p && typeof p.total === 'number' && p.total > 0) {
        fill.style.transition = 'width 0.3s';
        fill.style.width = `${Math.round(Math.min(1, p.done / p.total) * 100)}%`;
    } else if (p && p.ms) {
        // A known length: filled steadily, set going in showProgress.
    } else if (p) {
        fill.classList.add('fw-loose');
    } else {
        const f = planFraction();
        fill.style.transition = 'width 0.3s';
        fill.style.width = f === null ? '0%' : `${Math.round(f * 100)}%`;
    }
    parts.follow.classList.toggle('fw-on', following);
    parts.follow.classList.toggle('fw-call', !following && !takenOver);
    parts.follow.textContent = following ? 'Following' : 'Follow Claude';
    parts.take.textContent = takenOver ? 'Hand back to Claude' : 'Take over';
    parts.take.classList.toggle('fw-call', takenOver);
    if (identity.control) {
        parts.control.href = identity.control;
        parts.control.style.display = '';
    }
};

const download = async () => {
    try {
        const blob = await vm.saveProjectSb3();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${identity.name || 'project'}.sb3`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) {
        // The menu's File > Save still works.
    }
};

// --- taking over -------------------------------------------------------------------

const setTakenOver = on => {
    if (on === takenOver) return;
    takenOver = on;
    document.body.classList.toggle('fw-watching', !on);
    following = !on;
    if (options.onTakeover) options.onTakeover(on);
    renderHeader();
    updateTab();
};

// --- following -------------------------------------------------------------------

const VIEW_OF = {
    costume: ['addCostume', 'replaceCostume', 'renameCostume', 'deleteCostume', 'setCostume', 'costumeSheet',
        'costumes', 'createSprite'],
    sound: ['addSound', 'renameSound', 'deleteSound', 'playSound', 'sounds'],
    code: ['writeSprite', 'readSprite', 'checkText', 'tidyScripts', 'undo', 'selectSprite'],
    stage: ['greenFlag', 'keys', 'mouse', 'stepFrames', 'screenshot', 'answer', 'performance']
};
const viewFor = method => Object.keys(VIEW_OF).find(v => VIEW_OF[v].includes(method)) || null;
const TAB = {code: 0, costume: 1, sound: 2};

const targetNamed = name => {
    if (!name) return null;
    const all = vm.runtime.targets.filter(t => !t.isSprite() || t.isOriginal);
    return all.find(t => t.getName() === name) ||
        (String(name).toLowerCase() === 'stage' ? all.find(t => t.isStage) : null);
};

const clickTab = index => {
    const tab = document.querySelectorAll('[role="tab"]')[index];
    if (tab && tab.getAttribute('aria-selected') !== 'true') {
        programmatic = true;
        tab.click();
        programmatic = false;
    }
};

const stageButtons = () => [...document.querySelectorAll('[aria-pressed][title]')]
    .filter(b => /stage/i.test(b.title) && !/screen/i.test(b.title));

const setBigStage = big => {
    const buttons = stageButtons();
    if (!buttons.length) return;
    programmatic = true;
    if (big) {
        const now = buttons.find(b => b.getAttribute('aria-pressed') === 'true');
        const biggest = buttons[buttons.length - 1];
        if (now !== biggest) {
            if (!stageBefore) stageBefore = now ? now.title : null;
            biggest.click();
        }
    } else if (stageBefore) {
        const back = buttons.find(b => b.title === stageBefore);
        if (back) back.click();
        stageBefore = null;
    }
    programmatic = false;
};

const apply = view => {
    wanted = null;
    lastSwitch = Date.now();
    if (view.sprite) {
        const target = targetNamed(view.sprite);
        if (target && vm.editingTarget !== target) {
            programmatic = true;
            vm.setEditingTarget(target.id);
            programmatic = false;
        }
        const tile = target && !target.isStage ? spriteTile(target.getName()) : null;
        if (tile) pointAt(tile);
    }
    if (view.view === 'stage') {
        // The Costumes and Sounds tabs redraw their whole list every time a
        // sprite moves, which slows the game down while it runs: playing is
        // watched from the code.
        clickTab(TAB.code);
        setBigStage(true);
        clearTimeout(bigStageTimer);
        bigStageTimer = setTimeout(() => setBigStage(false), BIG_STAGE_MS);
    } else if (view.view === 'sound' && !sharedAudioContext()) {
        // The sound editor needs the page's audio, which the browser only
        // allows after the person has clicked somewhere: until then it would
        // break, so the Sounds tab is left alone.
    } else if (view.view in TAB) {
        clickTab(TAB[view.view]);
    }
};

/**
 * Claude is about to do this: go and look, unless the person is looking
 * somewhere else. Switches that come quickly one after another wait their
 * turn, and only the latest is shown.
 * @param {string} method the request
 * @param {object} params what it was asked
 */
export const follow = (method, params = {}) => {
    const view = viewFor(method);
    if (!view || takenOver) return;
    // Playing goes on wherever the person is: only the stage gets bigger.
    wanted = {view, sprite: view === 'stage' ? null : params.sprite || params.name || null};
    if (!following) return;
    clearTimeout(switchTimer);
    const wait = lastSwitch + DWELL_MS - Date.now();
    if (wait <= 0) apply(wanted);
    else switchTimer = setTimeout(() => wanted && apply(wanted), wait);
};

// The person clicking a tab, a sprite or the stage buttons themselves means
// they want to look there: following stops until they ask for it again.
const watchThePerson = () => {
    document.addEventListener('pointerdown', e => {
        if (!e.isTrusted || programmatic || takenOver || !following) return;
        const t = e.target;
        const toggle = t.closest('[aria-pressed]');
        if (t.closest('[role="tab"]') || t.closest('[class*="sprite-selector_sprite-selector"]') ||
            t.closest('[class*="stage-selector_stage-selector"]') ||
            (toggle && /stage/i.test(toggle.title || ''))) {
            following = false;
            clearTimeout(bigStageTimer);
            stageBefore = null;
            renderHeader();
        }
    }, true);
};

// Claude tests games over and over, in tabs nobody may be looking at, so they
// stay silent until the person asks to hear them. Done by unplugging the
// project's sound from the speakers rather than turning it down, so the volume
// addon and recording a video of the stage carry on as they were.
const MUTED_KEY = 'flipwarp:mcp-muted';
let muted = true;
try {
    muted = localStorage.getItem(MUTED_KEY) !== 'no';
} catch (e) {
    // No storage: muted, as for anyone who has not chosen.
}
let plugged = true;

const applySound = () => {
    parts.sound.textContent = muted ? 'Muted' : 'Sound on';
    parts.sound.title = muted ? 'Sound is off in this tab. Press to hear the game' : 'Press to mute the game';
    const engine = vm && vm.runtime && vm.runtime.audioEngine;
    if (!engine || !engine.inputNode || plugged === !muted) return;
    plugged = !muted;
    if (plugged) engine.inputNode.connect(engine.audioContext.destination);
    else engine.inputNode.disconnect(engine.audioContext.destination);
};

/**
 * @returns {boolean} whether this tab's sound is muted
 */
export const isMuted = () => muted;

const buildHeader = () => {
    header = el('div', 'fw-head');
    parts.who = el('span', 'fw-who');
    const mid = el('div', 'fw-mid');
    parts.label = el('div', 'fw-label');
    const track = el('div', 'fw-track');
    parts.fill = el('div', 'fw-fill');
    track.appendChild(parts.fill);
    mid.appendChild(parts.label);
    mid.appendChild(track);
    parts.follow = el('button', '', 'Following');
    parts.follow.title = 'Show what Claude is working on as it works';
    parts.follow.addEventListener('click', () => {
        if (takenOver) return;
        following = !following;
        renderHeader();
        if (following && wanted) apply(wanted);
    });
    parts.take = el('button', '', 'Take over');
    parts.take.title = 'Edit the project yourself; Claude waits until you hand it back';
    parts.take.addEventListener('click', () => setTakenOver(!takenOver));
    parts.sound = el('button', '', '');
    parts.sound.addEventListener('click', () => {
        muted = !muted;
        try {
            localStorage.setItem(MUTED_KEY, muted ? 'yes' : 'no');
        } catch (e) {
            // Remembered for this tab only, then.
        }
        applySound();
    });
    const save = el('button', 'fw-extra', 'Download');
    save.title = 'Save the project as it is now to your computer';
    save.addEventListener('click', download);
    parts.control = el('a', 'fw-btn fw-extra', 'All chats');
    parts.control.target = '_blank';
    parts.control.title = 'The control room: every chat working in Flipwarp';
    parts.control.style.display = 'none';
    for (const p of [parts.who, mid, parts.follow, parts.take, parts.sound, save, parts.control]) header.appendChild(p);
    document.body.appendChild(header);
};

// The header sits in the menu bar, taking its own room there, so it never
// covers the editor's controls. In full screen, which covers the menu bar,
// or before the editor has drawn one, it floats in a corner instead.
// "See Project Page" makes room for it: it does nothing for a local project.
// Done with classes set here rather than CSS :has(), which made the browser
// recheck the whole page on every change and loading take four times as long.
const dock = () => {
    const mainMenu = document.querySelector('[class*="menu-bar_main-menu"]');
    const full = !!document.querySelector('[class*="stage-wrapper_full-screen"]');
    const bar = !full && mainMenu && mainMenu.parentElement;
    const home = bar || document.body;
    if (header.parentElement !== home) home.appendChild(header);
    header.classList.toggle('fw-docked', !!bar);
    document.body.classList.toggle('fw-full', full);
    const projectPage = document.querySelector('[class*="community-button_community-button"]');
    const item = projectPage && projectPage.closest('[class*="menu-bar_menu-bar-item"]');
    if (item) item.classList.toggle('fw-making-room', !!bar);
};

// --- what the bridge tells this ----------------------------------------------------

/**
 * Something Claude is doing, with how far along it is.
 * @param {?object} p {label, done, total} or {label, ms} or {label}, or null when it is over
 */
export const showProgress = p => {
    clearTimeout(progressTimer);
    const over = !p || (typeof p.total === 'number' && p.done >= p.total);
    if (over) {
        if (progressNow && parts.fill) parts.fill.style.width = '100%';
        progressTimer = setTimeout(() => {
            progressNow = null;
            renderHeader();
        }, 400);
        return;
    }
    progressNow = p;
    renderHeader();
    if (p.ms && parts.fill) {
        const fill = parts.fill;
        fill.style.transition = 'none';
        fill.style.width = '0%';
        // Read once so the browser starts the bar from empty.
        fill.getBoundingClientRect();
        fill.style.transition = `width ${p.ms}ms linear`;
        fill.style.width = '100%';
        progressTimer = setTimeout(() => {
            progressNow = null;
            renderHeader();
        }, p.ms + 300);
    }
};

/** @param {object} next {color, name, port, control} from the server */
export const setIdentity = next => {
    identity = {
        color: next.color || identity.color,
        name: next.name || identity.name,
        port: next.port || identity.port,
        control: next.control || identity.control
    };
    renderHeader();
    updateTab();
};

/** @param {?object} next {steps, current, status} */
export const setPlan = next => {
    plan = next;
    renderHeader();
    updateTab();
};

/** @param {boolean} on whether the server is there */
export const setConnected = on => {
    connected = on;
    renderHeader();
    updateTab();
};

/** A request from Claude has come in. */
export const markBusy = () => {
    lastBusy = Date.now();
    updateTab();
};

/** @returns {boolean} whether the person has the editor */
export const isTakenOver = () => takenOver;

/**
 * Points Claude's cursor at a sprite's tile (after a request about it).
 * @param {string} name the sprite
 */
export const pointAtSprite = name => {
    const tile = spriteTile(name);
    if (tile) pointAt(tile);
};

// --- thumbnails ------------------------------------------------------------------

/**
 * A small picture of the stage as it is now. Drawn here even in a hidden tab,
 * where the editor does not draw it.
 * @param {number} [width] pixels across
 * @returns {Promise<?string>} a JPEG data URL, or null
 */
export const snapshot = (width = 160) => new Promise(resolve => {
    const renderer = vm && vm.renderer;
    if (!renderer || !renderer.requestSnapshot) {
        resolve(null);
        return;
    }
    let done = false;
    const give = url => {
        if (done) return;
        done = true;
        if (!url) {
            resolve(null);
            return;
        }
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = width;
            c.height = Math.round(width * 3 / 4);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            resolve(c.toDataURL('image/jpeg', 0.6));
        };
        img.onerror = () => resolve(null);
        img.src = url;
    };
    try {
        renderer.requestSnapshot(give);
        renderer.draw();
    } catch (e) {
        give(null);
    }
    setTimeout(() => give(null), 800);
});

// --- putting it on the page ------------------------------------------------------

/**
 * @param {object} virtualMachine the VM
 * @param {object} opts onTakeover(on), isIdlePaused()
 */
export const installWatch = (virtualMachine, opts = {}) => {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    vm = virtualMachine;
    options = opts;
    if (opts.isIdlePaused) idlePausedFn = opts.isIdlePaused;
    const style = el('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.body.classList.add('fw-watching');
    buildHeader();
    cursor = el('div', 'fw-cursor');
    cursor.innerHTML = '<svg width="18" height="22" viewBox="0 0 18 22"><path d="M1 1 L1 18 L6 13 L10 21 ' +
        'L13 19.5 L9 12 L16 12 Z" fill="var(--fw-chat, #3a86ff)" stroke="#fff" stroke-width="1.5"/></svg>' +
        '<span>Claude</span>';
    document.body.appendChild(cursor);
    onRipple(showCursorAt);
    watchThePerson();
    renderHeader();
    // The editor sets its own title when the project changes; this keeps the
    // chat's state on it, and the busy sign goes once Claude has gone quiet.
    // The menu bar can be drawn again too, so the header goes back into it.
    setInterval(() => {
        updateTab();
        dock();
        applySound();
    }, 1000);
    updateTab();
    dock();
    applySound();
    // Full screen comes and goes on a click or a key: move with it at once.
    const soon = () => setTimeout(dock, 50);
    document.addEventListener('click', soon, true);
    document.addEventListener('keyup', soon, true);
};
