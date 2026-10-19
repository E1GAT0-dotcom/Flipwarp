// Watching Claude work: what it just did, what it says it is doing, and the
// keys it is pressing while it plays. Only ever on the page when the editor
// was opened with ?mcp, so nobody else sees any of it.
//
// Three things on top of the editor:
//   - the activity strip, over the top right of the code area: a line for
//     each thing Claude did, newest first, the latest write with an undo
//     button, and above them whatever Claude last said with narrate;
//   - the keys Claude is holding, over the bottom left of the stage;
//   - a ripple where Claude clicked the stage.

const MAX_ENTRIES = 7;

let installed = false;
let strip = null;
let narrationBox = null;
let list = null;
let keysBox = null;
let collapsed = false;
let handlers = {};
const entries = [];

const css = `
.fw-live { position: fixed; z-index: 500; width: 300px; font: 12px/1.35 "Helvetica Neue", Helvetica, Arial,
  sans-serif; color: #e8e8ea; background: rgba(17, 18, 26, 0.9); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,0.35); overflow: hidden; pointer-events: auto; }
.fw-live-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: rgba(255,255,255,0.06);
  cursor: pointer; user-select: none; font-weight: bold; }
.fw-live-dot { width: 8px; height: 8px; border-radius: 50%; background: #3ce68c; box-shadow: 0 0 6px #3ce68c; }
.fw-live-dot.fw-busy { background: #ffd23f; box-shadow: 0 0 8px #ffd23f; }
.fw-live-head span.fw-grow { flex: 1; }
.fw-live-say { padding: 8px 10px; font-size: 13px; color: #ffffff; border-bottom: 1px solid rgba(255,255,255,0.08);
  background: linear-gradient(90deg, rgba(58,134,255,0.25), rgba(58,134,255,0)); }
.fw-live-say:empty { display: none; }
.fw-live-list { list-style: none; margin: 0; padding: 4px 0; max-height: 220px; overflow-y: auto; }
.fw-live-list li { display: flex; gap: 6px; align-items: baseline; padding: 3px 10px; }
.fw-live-list li.fw-dim { color: #9aa0b4; }
.fw-live-list li.fw-bad { color: #ff8a80; }
.fw-live-list li.fw-jump { cursor: pointer; }
.fw-live-list li.fw-jump:hover { background: rgba(255,255,255,0.06); }
.fw-live-list li .fw-what { flex: 1; }
.fw-live-list li .fw-when { color: #6b7080; font-size: 11px; }
.fw-live-list button { font: inherit; font-size: 11px; color: #fff; background: #3a86ff; border: 0; border-radius: 4px;
  padding: 1px 6px; cursor: pointer; }
.fw-live.fw-collapsed .fw-live-list, .fw-live.fw-collapsed .fw-live-say { display: none; }
.fw-keys { position: fixed; z-index: 500; display: flex; gap: 4px; align-items: flex-end; pointer-events: none;
  transition: opacity 0.4s; }
.fw-keys.fw-hidden { opacity: 0; }
.fw-pad { display: grid; grid-template-columns: repeat(3, 26px); grid-template-rows: repeat(2, 26px); gap: 3px; }
.fw-cap { min-width: 26px; height: 26px; box-sizing: border-box; padding: 0 5px; display: flex; align-items: center;
  justify-content: center; font: bold 12px "Helvetica Neue", Helvetica, Arial, sans-serif; color: #c9cdd6;
  background: rgba(17,18,26,0.7); border: 1px solid rgba(255,255,255,0.25); border-radius: 5px; }
.fw-cap.fw-down { color: #11121a; background: #ffd23f; border-color: #ffd23f; box-shadow: 0 0 10px #ffd23f; }
.fw-ripple { position: fixed; z-index: 501; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
  border: 3px solid #ffd23f; pointer-events: none; animation: fw-ripple 0.6s ease-out forwards; }
@keyframes fw-ripple { from { transform: scale(0.5); opacity: 1; } to { transform: scale(3.5); opacity: 0; } }
`;

const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (typeof text === 'string') e.textContent = text;
    return e;
};

const ago = at => {
    const s = Math.round((Date.now() - at) / 1000);
    if (s < 5) return 'now';
    if (s < 60) return `${s}s`;
    return `${Math.round(s / 60)}m`;
};

// --- where things go -----------------------------------------------------------

const codeArea = () => document.querySelector('.injectionDiv') || document.querySelector('.blocklySvg');
const stageCanvas = () => {
    const canvases = [...document.querySelectorAll('canvas')];
    return canvases.find(c => c.width > 0 && c.getBoundingClientRect().width > 100 &&
        c.closest('[class*="stage"]')) || null;
};

const place = () => {
    if (strip) {
        const area = codeArea();
        const rect = area ? area.getBoundingClientRect() : null;
        if (rect && rect.width) {
            strip.style.top = `${Math.round(rect.top + 10)}px`;
            strip.style.left = `${Math.round(rect.right - 300 - 14)}px`;
            strip.style.display = '';
        } else {
            strip.style.display = 'none';
        }
    }
    if (keysBox) {
        const canvas = stageCanvas();
        const rect = canvas ? canvas.getBoundingClientRect() : null;
        if (rect && rect.width) {
            keysBox.style.left = `${Math.round(rect.left + 8)}px`;
            keysBox.style.top = `${Math.round(rect.bottom - 64)}px`;
        }
    }
};

// --- the strip -----------------------------------------------------------------

const render = () => {
    if (!list) return;
    list.textContent = '';
    const latestWrite = entries.find(e => e.undo);
    const {onUndo, onJump} = handlers;
    for (const entry of entries) {
        const li = el('li', entry.tone ? `fw-${entry.tone}` : '');
        li.appendChild(el('span', 'fw-icon', entry.icon));
        li.appendChild(el('span', 'fw-what', entry.count > 1 ? `${entry.text} ×${entry.count}` : entry.text));
        if (entry === latestWrite && onUndo) {
            const undo = el('button', '', 'undo');
            undo.title = 'Put this sprite back as it was before';
            undo.addEventListener('click', e => {
                e.stopPropagation();
                // Undone once: the button goes, so it cannot undo the write
                // before this one by being pressed again.
                entry.undo = false;
                onUndo();
            });
            li.appendChild(undo);
        }
        li.appendChild(el('span', 'fw-when', ago(entry.at)));
        if (entry.sprite && onJump) {
            li.classList.add('fw-jump');
            li.title = `Show ${entry.sprite}`;
            li.addEventListener('click', () => onJump(entry.sprite, entry.ids || []));
        }
        list.appendChild(li);
    }
};

/**
 * Adds a line to the strip. A dim line the same as the one before it is
 * counted instead of repeated, so a play-test does not wash everything else
 * out of view.
 * @param {object} entry {icon, text, tone ('dim' | 'bad' | ''), sprite, ids, undo}
 */
export const record = entry => {
    if (!installed) return;
    const last = entries[0];
    if (last && entry.tone === 'dim' && last.text === entry.text && last.icon === entry.icon) {
        last.count = (last.count || 1) + 1;
        last.at = Date.now();
    } else {
        entries.unshift({...entry, at: Date.now(), count: 1});
        if (entry.undo) for (const e of entries.slice(1)) e.undo = false;
        entries.length = Math.min(entries.length, MAX_ENTRIES);
    }
    render();
};

let busyTimer = null;
/** Lights the dot while a request is being worked on. */
export const busy = () => {
    if (!strip) return;
    const dot = strip.querySelector('.fw-live-dot');
    dot.classList.add('fw-busy');
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => dot.classList.remove('fw-busy'), 600);
};

/**
 * Shows what Claude says it is doing, until it says something else.
 * @param {string} text one or two sentences
 */
export const narrate = text => {
    if (!narrationBox) return;
    narrationBox.textContent = String(text).slice(0, 300);
    if (collapsed) {
        collapsed = false;
        strip.classList.remove('fw-collapsed');
    }
};

// --- keys and clicks -------------------------------------------------------------

const ARROWS = {'up arrow': '▲', 'left arrow': '◀', 'down arrow': '▼', 'right arrow': '▶'};
let keysTimer = null;

/**
 * Shows the keys Claude is holding. Hides a little after the last one goes.
 * @param {Iterable<string>} held Scratch key names
 */
export const keysChanged = held => {
    if (!keysBox) return;
    const down = new Set(held);
    keysBox.textContent = '';
    const pad = el('div', 'fw-pad');
    const cell = (name, col, row) => {
        const cap = el('div', `fw-cap${down.has(name) ? ' fw-down' : ''}`, ARROWS[name]);
        cap.style.gridColumn = col;
        cap.style.gridRow = row;
        pad.appendChild(cap);
    };
    cell('up arrow', 2, 1);
    cell('left arrow', 1, 2);
    cell('down arrow', 2, 2);
    cell('right arrow', 3, 2);
    keysBox.appendChild(pad);
    for (const name of down) {
        if (ARROWS[name]) continue;
        keysBox.appendChild(el('div', 'fw-cap fw-down', name === 'space' ? 'space' : name.toUpperCase()));
    }
    place();
    clearTimeout(keysTimer);
    keysBox.classList.remove('fw-hidden');
    if (!down.size) keysTimer = setTimeout(() => keysBox.classList.add('fw-hidden'), 2500);
};

/**
 * A ripple where Claude pressed the mouse on the stage.
 * @param {number} clientX page position
 * @param {number} clientY page position
 */
export const ripple = (clientX, clientY) => {
    if (!installed) return;
    const r = el('div', 'fw-ripple');
    r.style.left = `${clientX}px`;
    r.style.top = `${clientY}px`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 700);
};

// --- putting it on the page ------------------------------------------------------

/**
 * @param {object} options onUndo(), onJump(sprite, ids)
 */
export const installLive = options => {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    handlers = options || {};
    const style = el('style');
    style.textContent = css;
    document.head.appendChild(style);

    strip = el('div', 'fw-live');
    const head = el('div', 'fw-live-head');
    head.appendChild(el('span', 'fw-live-dot'));
    head.appendChild(el('span', 'fw-grow', 'Claude is working here'));
    const toggle = el('span', '', '–');
    head.appendChild(toggle);
    head.title = 'Show or hide what Claude is doing';
    head.addEventListener('click', () => {
        collapsed = !collapsed;
        strip.classList.toggle('fw-collapsed', collapsed);
        toggle.textContent = collapsed ? '+' : '–';
    });
    strip.appendChild(head);
    narrationBox = el('div', 'fw-live-say');
    strip.appendChild(narrationBox);
    list = el('ul', 'fw-live-list');
    strip.appendChild(list);
    document.body.appendChild(strip);

    keysBox = el('div', 'fw-keys fw-hidden');
    document.body.appendChild(keysBox);

    place();
    window.addEventListener('resize', place);
    // The editor's layout changes without telling anyone (stage size,
    // tabs), so the overlays follow it, and the times stay fresh.
    setInterval(() => {
        place();
        render();
    }, 1000);
};

// --- what a request looks like in the strip ---------------------------------------

const keyNames = keys => keys.map(k => ARROWS[k] || k).join(' ');

/**
 * The line for a request the bridge answered, or null for none.
 * @param {string} method the request
 * @param {object} params what it was asked
 * @param {object} result what it answered
 * @param {boolean} failed whether it threw
 * @returns {?object} an entry for record()
 */
export const describe = (method, params = {}, result = {}, failed = false) => {
    const sprite = params.sprite;
    switch (method) {
    case 'writeSprite':
        if (!result.ok) {
            const line = result.error && result.error.parse ? ` (line ${result.error.parse.line})` : '';
            return {icon: '✏️', text: `${sprite}: a mistake${line}, nothing changed`, tone: 'bad', sprite};
        }
        if (!result.changed) return {icon: '✏️', text: `${sprite}: no change`, tone: 'dim', sprite};
        return {icon: '✏️',
            text: `wrote ${sprite}${result.summary ? `: ${result.summary}` : ''}`,
            sprite,
            ids: result.changedIds,
            undo: true};
    case 'checkText':
        return {icon: '🧪', text: `checked text for ${sprite}${result.ok ? '' : ': a mistake'}`, tone: 'dim', sprite};
    case 'readSprite': return {icon: '👀', text: `read ${sprite}`, tone: 'dim', sprite};
    case 'undo': return {icon: '↩️', text: `undid ${result.sprite || 'the last write'}`, sprite: result.sprite};
    case 'createSprite': return {icon: '✨', text: `made sprite ${result.name || params.name}`, sprite: result.name};
    case 'deleteSprite': return {icon: '🗑️', text: `deleted ${sprite}`};
    case 'renameSprite': return {icon: '🏷️', text: `renamed ${sprite} to ${params.name}`, sprite: params.name};
    case 'addCostume':
        return {icon: '🎨', text: `drew ${result.costume ? `"${result.costume.name}"` : 'a costume'} for ${sprite}`};
    case 'replaceCostume':
        return {icon: '🎨', text: `redrew ${result.costume ? `"${result.costume.name}"` : 'a costume'} in ${sprite}`};
    case 'previewImage': return {icon: '🎨', text: 'sketching a drawing', tone: 'dim'};
    case 'costumeSheet': return {icon: '🖼️', text: `looked at ${sprite}'s costumes`, tone: 'dim'};
    case 'tidyScripts': return {icon: '🧹', text: `tidied ${sprite}'s scripts`, sprite};
    case 'greenFlag': return {icon: '🟢', text: 'green flag'};
    case 'stop': return {icon: '⏹️', text: 'stopped the project'};
    case 'keys': {
        const down = (params.down || []).length ? `holding ${keyNames(params.down)}` : '';
        const up = (params.up || []).length ? `let go of ${keyNames(params.up)}` : '';
        return {icon: '⌨️', text: [down, up].filter(Boolean).join(', ') || 'keys', tone: 'dim'};
    }
    case 'releaseKeys': return {icon: '⌨️', text: 'let go of the keys', tone: 'dim'};
    case 'mouse': return typeof params.down === 'boolean' && params.down ?
        {icon: '🖱️', text: `clicked at ${Math.round(params.x)}, ${Math.round(params.y)}`, tone: 'dim'} : null;
    case 'stepFrames': return {icon: '⏯️', text: 'ran frames one by one', tone: 'dim'};
    case 'freeze': return {icon: params.frozen ? '⏸️' : '▶️', text: params.frozen ? 'paused' : 'resumed', tone: 'dim'};
    case 'screenshot': return {icon: '📸', text: 'looked at the stage', tone: 'dim'};
    case 'state': return {icon: '📊', text: 'checked the game state', tone: 'dim'};
    case 'answer': return {icon: '💬', text: `answered "${params.text}"`};
    case 'health': return {icon: '🩺', text: 'ran the health check', tone: 'dim'};
    case 'fixHealth': return {icon: '🩺', text: 'fixed what the health check found'};
    case 'gameOptions': return {icon: '⚙️', text: 'changed game options', tone: 'dim'};
    case 'setVariable': return {icon: '🔧', text: `set ${params.name} to ${JSON.stringify(params.value)}`, tone: 'dim'};
    case 'saveProject': return {icon: '💾', text: 'saved the project'};
    case 'loadProject': return {icon: '📂', text: 'opened a project'};
    default:
        return failed ? {icon: '⚠️', text: `${method} did not work`, tone: 'bad'} : null;
    }
};
