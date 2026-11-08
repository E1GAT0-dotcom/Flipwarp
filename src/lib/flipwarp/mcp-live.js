// Watching Claude work: what it did, why, and what it says it is doing; the
// keys it is pressing while it plays. Only ever on the page when the editor
// was opened with ?mcp, so nobody else sees any of it.
//
// On top of the editor:
//   - the timeline, over the top right of the code area: Claude's plan as a
//     checklist, whatever it last said with narrate, then a line for each
//     thing it did, newest first, with its reason, a picture where there is
//     one, and the change itself on a click (a write shows its text before
//     and after). The latest write has an undo button. At the bottom, a box
//     to leave Claude a note, which reaches it with its next step; the pin
//     button points the note at a sprite. Replay plays the pictures back in
//     order: the game being built.
//   - the keys Claude is holding, over the bottom left of the stage;
//   - a ripple where Claude clicked the stage.
// Full screen is for playing: the timeline goes until the person comes back.

const MAX_ENTRIES = 80;

let installed = false;
let strip = null;
let narrationBox = null;
let planBox = null;
let list = null;
let keysBox = null;
let noteInput = null;
let noteStatus = null;
let collapsed = false;
let handlers = {};
let pointingAbout = null;
let pointing = false;
const entries = [];
const rippleListeners = [];

const css = `
.fw-live { position: fixed; z-index: 500; width: min(330px, calc(100vw - 16px));
  font: 12px/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #e8e8ea;
  background: rgba(17, 18, 26, 0.92); border: 1px solid rgba(255,255,255,0.12);
  border-top: 4px solid var(--fw-chat, #3a86ff); border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,0.35);
  overflow: hidden; pointer-events: auto; display: flex; flex-direction: column; max-height: 70vh; }
.fw-live-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: rgba(255,255,255,0.06);
  cursor: pointer; user-select: none; font-weight: bold; flex: none; }
.fw-live-dot { width: 8px; height: 8px; border-radius: 50%; background: #3ce68c; box-shadow: 0 0 6px #3ce68c; }
.fw-live-dot.fw-busy { background: #ffd23f; box-shadow: 0 0 8px #ffd23f; }
.fw-live-head span.fw-grow { flex: 1; }
.fw-live-head button, .fw-live-note button, .fw-modal button { font: inherit; font-size: 11px; color: #fff;
  background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 1px 6px;
  cursor: pointer; font-weight: normal; }
.fw-live-plan { padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); flex: none; }
.fw-live-plan:empty { display: none; }
.fw-live-plan div { display: flex; gap: 6px; padding: 1px 0; color: #9aa0b4; }
.fw-live-plan div.fw-now { color: #fff; font-weight: bold; }
.fw-live-plan div.fw-done { color: #6b7080; text-decoration: line-through; }
.fw-live-say { padding: 8px 10px; font-size: 13px; color: #ffffff; border-bottom: 1px solid rgba(255,255,255,0.08);
  background: linear-gradient(90deg, rgba(58,134,255,0.25), rgba(58,134,255,0)); flex: none; }
.fw-live-say:empty { display: none; }
.fw-live-list { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; flex: 1; min-height: 60px; }
.fw-live-list li { display: flex; gap: 6px; align-items: flex-start; padding: 3px 10px; }
.fw-live-list li.fw-dim { color: #9aa0b4; }
.fw-live-list li.fw-bad { color: #ff8a80; }
.fw-live-list li.fw-good { color: #9be7b4; }
.fw-live-list li.fw-jump { cursor: pointer; }
.fw-live-list li.fw-jump:hover { background: rgba(255,255,255,0.06); }
.fw-live-list li .fw-what { flex: 1; min-width: 0; }
.fw-live-list li .fw-why { display: block; color: #8d93a6; font-size: 11px; font-style: italic; }
.fw-live-list li .fw-when { color: #6b7080; font-size: 11px; white-space: nowrap; }
.fw-live-list li img { width: 48px; height: 36px; object-fit: cover; border-radius: 3px; border: 1px solid
  rgba(255,255,255,0.15); background: #fff; flex: none; }
.fw-live-list button { font: inherit; font-size: 11px; color: #fff; background: #3a86ff; border: 0; border-radius: 4px;
  padding: 1px 6px; cursor: pointer; }
.fw-live-note { display: flex; gap: 4px; padding: 6px 8px; border-top: 1px solid rgba(255,255,255,0.08); flex: none;
  flex-wrap: wrap; }
.fw-live-note input { flex: 1; min-width: 0; font: inherit; color: #fff; background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.18); border-radius: 4px; padding: 3px 6px; }
.fw-live-note button.fw-on { background: #ffbe0b; color: #11121a; }
.fw-live-note .fw-note-status { width: 100%; color: #8d93a6; font-size: 11px; }
.fw-live-note .fw-note-status:empty { display: none; }
.fw-live.fw-collapsed .fw-live-list, .fw-live.fw-collapsed .fw-live-say, .fw-live.fw-collapsed .fw-live-plan,
.fw-live.fw-collapsed .fw-live-note { display: none; }
.fw-modal { position: fixed; inset: 0; z-index: 800; background: rgba(0,0,0,0.6); display: flex; align-items: center;
  justify-content: center; font: 13px/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; }
.fw-modal-box { background: #1b1d28; color: #e8e8ea; border-radius: 10px; padding: 12px; max-width: 90vw;
  max-height: 85vh; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
.fw-modal-box pre { margin: 0; overflow: auto; font: 12px/1.4 Consolas, Menlo, monospace; max-height: 70vh;
  min-width: min(700px, 80vw); background: #11121a; padding: 8px; border-radius: 6px; }
.fw-modal-box pre span { display: block; white-space: pre; }
.fw-modal-box pre .fw-add { background: rgba(60,230,140,0.15); color: #9be7b4; }
.fw-modal-box pre .fw-del { background: rgba(255,90,90,0.15); color: #ff9a9a; }
.fw-modal-box pre .fw-gap { color: #6b7080; }
.fw-modal-box img { max-width: 80vw; max-height: 70vh; image-rendering: auto; background: #fff; border-radius: 6px; }
.fw-modal-row { display: flex; gap: 8px; align-items: center; }
.fw-modal-row input[type=range] { flex: 1; }
.fw-modal-cap { min-height: 2.8em; }
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
body.fw-full .fw-live { display: none; }
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
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
};

// --- where things go -----------------------------------------------------------

const codeArea = () => document.querySelector('.injectionDiv') || document.querySelector('.blocklySvg');
const stageCanvas = () => {
    const canvases = [...document.querySelectorAll('canvas')];
    return canvases.find(c => c.width > 0 && c.getBoundingClientRect().width > 100 &&
        c.closest('[class*="stage"]')) || null;
};

const place = () => {
    // Hidden (full screen) it has no width to place by: left where it was.
    if (strip && strip.offsetWidth) {
        // Over the code area when it is showing; over the right of the page
        // when the Costumes or Sounds tab is, so it is always there.
        const area = codeArea();
        const rect = area ? area.getBoundingClientRect() : null;
        const top = rect && rect.width ? rect.top + 10 : 100;
        const right = rect && rect.width ? rect.right : window.innerWidth;
        strip.style.top = `${Math.round(Math.max(56, top))}px`;
        strip.style.left = `${Math.round(Math.max(8, right - strip.offsetWidth - 14))}px`;
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

// --- looking closer ----------------------------------------------------------------

const modal = build => {
    const back = el('div', 'fw-modal');
    const box = el('div', 'fw-modal-box');
    back.appendChild(box);
    let onKey = null;
    const close = () => {
        back.remove();
        document.removeEventListener('keydown', onKey, true);
    };
    onKey = e => {
        if (e.key === 'Escape') close();
    };
    back.addEventListener('click', e => {
        if (e.target === back) close();
    });
    document.addEventListener('keydown', onKey, true);
    build(box, close);
    document.body.appendChild(back);
};

const showDetail = entry => modal((box, close) => {
    const row = el('div', 'fw-modal-row');
    row.appendChild(el('b', '', entry.text));
    row.appendChild(el('span', 'fw-grow', ''));
    const x = el('button', '', 'close');
    x.addEventListener('click', close);
    row.appendChild(x);
    box.appendChild(row);
    if (entry.why) box.appendChild(el('div', 'fw-why', entry.why));
    if (entry.diff) {
        const pre = el('pre');
        for (const line of entry.diff) {
            pre.appendChild(el('span', line.t === '+' ? 'fw-add' : line.t === '-' ? 'fw-del' : line.t === '…' ?
                'fw-gap' : '', `${line.t === '…' ? '' : `${line.t} `}${line.s}`));
        }
        box.appendChild(pre);
    }
    if (entry.picture || entry.thumb) {
        const img = el('img');
        img.src = entry.picture || entry.thumb;
        box.appendChild(img);
    }
});

// The game being built: every picture in the timeline, oldest first.
const replay = () => {
    const frames = entries.filter(e => e.thumb || e.picture).slice()
        .reverse();
    modal((box, close) => {
        if (!frames.length) {
            box.appendChild(el('div', '', 'No pictures yet: they are taken as Claude writes, draws and plays.'));
            const x = el('button', '', 'close');
            x.addEventListener('click', close);
            box.appendChild(x);
            return;
        }
        const img = el('img');
        img.style.width = '480px';
        img.style.height = '360px';
        img.style.objectFit = 'contain';
        const cap = el('div', 'fw-modal-cap');
        const row = el('div', 'fw-modal-row');
        const play = el('button', '', '❚❚');
        const slider = el('input');
        slider.type = 'range';
        slider.min = 0;
        slider.max = frames.length - 1;
        const x = el('button', '', 'close');
        let at = 0;
        let timer = null;
        const show = i => {
            at = i;
            slider.value = i;
            const f = frames[i];
            img.src = f.picture || f.thumb;
            cap.textContent = `${i + 1}/${frames.length} · ${f.icon} ${f.text}${f.why ? ` — ${f.why}` : ''}`;
        };
        const tick = () => {
            if (at >= frames.length - 1) {
                clearInterval(timer);
                timer = null;
                play.textContent = '▶';
                return;
            }
            show(at + 1);
        };
        play.addEventListener('click', () => {
            if (timer) {
                clearInterval(timer);
                timer = null;
                play.textContent = '▶';
            } else {
                if (at >= frames.length - 1) show(0);
                timer = setInterval(tick, 900);
                play.textContent = '❚❚';
            }
        });
        slider.addEventListener('input', () => show(Number(slider.value)));
        x.addEventListener('click', () => {
            clearInterval(timer);
            close();
        });
        row.appendChild(play);
        row.appendChild(slider);
        row.appendChild(x);
        box.appendChild(img);
        box.appendChild(cap);
        box.appendChild(row);
        show(0);
        timer = setInterval(tick, 900);
    });
};

// --- the timeline ----------------------------------------------------------------

const render = () => {
    if (!list) return;
    list.textContent = '';
    const latestWrite = entries.find(e => e.undo);
    const {onUndo, onJump} = handlers;
    for (const entry of entries) {
        const li = el('li', entry.tone ? `fw-${entry.tone}` : '');
        li.appendChild(el('span', 'fw-icon', entry.icon));
        const what = el('span', 'fw-what', entry.count > 1 ? `${entry.text} ×${entry.count}` : entry.text);
        if (entry.why) what.appendChild(el('span', 'fw-why', entry.why));
        li.appendChild(what);
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
        if (entry.thumb) {
            const img = el('img');
            img.src = entry.thumb;
            li.appendChild(img);
        }
        li.appendChild(el('span', 'fw-when', ago(entry.at)));
        if (entry.diff || entry.picture || entry.thumb) {
            li.classList.add('fw-jump');
            li.title = entry.diff ? 'See the change' : 'See the picture';
            li.addEventListener('click', () => {
                if (entry.sprite && onJump) onJump(entry.sprite, entry.ids || []);
                showDetail(entry);
            });
        } else if (entry.sprite && onJump) {
            li.classList.add('fw-jump');
            li.title = `Show ${entry.sprite}`;
            li.addEventListener('click', () => onJump(entry.sprite, entry.ids || []));
        }
        list.appendChild(li);
    }
};

// Only the times change on their own: rebuilding every line and picture
// each second would cost the game a hitch every second.
const refreshTimes = () => {
    if (!list) return;
    const times = list.querySelectorAll('.fw-when');
    entries.forEach((entry, i) => {
        const now = ago(entry.at);
        if (times[i] && times[i].textContent !== now) times[i].textContent = now;
    });
};

/**
 * Adds a line to the timeline. A dim line the same as the one before it is
 * counted instead of repeated, so a play-test does not wash everything else
 * out of view.
 * @param {object} entry {icon, text, tone ('dim' | 'bad' | 'good' | ''), why, sprite, ids, undo, diff, thumb,
 *     picture}
 * @returns {?object} the entry as kept, to add a picture to later
 */
export const record = entry => {
    if (!installed) return null;
    const last = entries[0];
    if (last && entry.tone === 'dim' && !entry.why && last.text === entry.text && last.icon === entry.icon) {
        last.count = (last.count || 1) + 1;
        last.at = Date.now();
        render();
        return last;
    }
    const kept = {...entry, at: Date.now(), count: 1};
    entries.unshift(kept);
    if (entry.undo) for (const e of entries.slice(1)) e.undo = false;
    entries.length = Math.min(entries.length, MAX_ENTRIES);
    render();
    return kept;
};

/**
 * Adds a picture to a line already in the timeline, once it has been taken.
 * @param {object} entry what record returned
 * @param {string} thumb a small picture
 */
export const addThumb = (entry, thumb) => {
    if (!entry || !thumb) return;
    entry.thumb = thumb;
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

/**
 * Claude's plan as a checklist.
 * @param {?object} plan {steps, current, status}
 */
export const showPlan = plan => {
    if (!planBox) return;
    planBox.textContent = '';
    if (!plan || !plan.steps || !plan.steps.length) return;
    plan.steps.forEach((step, i) => {
        const n = i + 1;
        const done = plan.status === 'done' || n < plan.current;
        const now = !done && n === plan.current;
        const row = el('div', done ? 'fw-done' : now ? 'fw-now' : '');
        row.appendChild(el('span', '', done ? '✓' : now ? '▶' : '○'));
        row.appendChild(el('span', '', step));
        planBox.appendChild(row);
    });
};

/** Claude has had the notes that were waiting. */
export const notesRead = () => {
    if (noteStatus) noteStatus.textContent = 'Claude has your note.';
    setTimeout(() => {
        if (noteStatus && noteStatus.textContent === 'Claude has your note.') noteStatus.textContent = '';
    }, 8000);
};

// --- notes for Claude ------------------------------------------------------------

const sendNote = () => {
    const text = noteInput.value.trim();
    if (!text || !handlers.onNote) return;
    handlers.onNote(text, pointingAbout);
    noteInput.value = '';
    const about = pointingAbout ? ` (about ${pointingAbout})` : '';
    noteStatus.textContent = `Sent${about}. Claude gets it with its next step.`;
    pointingAbout = null;
};

// Pointing: the next click on a sprite's tile (or on the stage) says what the
// note is about. The click is kept from doing anything else.
const startPointing = button => {
    pointing = true;
    button.classList.add('fw-on');
    noteStatus.textContent = 'Click a sprite, or a place on the stage, for the note to be about.';
    let pick = null;
    const done = () => {
        pointing = false;
        button.classList.remove('fw-on');
        document.removeEventListener('pointerdown', pick, true);
    };
    pick = e => {
        if (e.target === button) return;
        const tile = e.target.closest('[class*="sprite-selector-item_sprite-selector-item"]');
        const name = tile && tile.querySelector('[class*="sprite-selector-item_sprite-name"]');
        const canvas = stageCanvas();
        const r = canvas && canvas.getBoundingClientRect();
        if (name) {
            pointingAbout = `the sprite "${name.textContent}"`;
        } else if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            const x = Math.round((((e.clientX - r.left) / r.width) * 480) - 240);
            const y = Math.round(180 - (((e.clientY - r.top) / r.height) * 360));
            pointingAbout = `the spot x ${x}, y ${y} on the stage`;
        } else {
            noteStatus.textContent = 'That is not a sprite or the stage. Try again, or press the pin to stop.';
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        noteStatus.textContent = `The note is about ${pointingAbout}.`;
        done();
        noteInput.focus();
    };
    document.addEventListener('pointerdown', pick, true);
    return done;
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
    for (const fn of rippleListeners) fn(clientX, clientY);
};

/** @param {function} fn called with (clientX, clientY) wherever Claude clicks */
export const onRipple = fn => {
    rippleListeners.push(fn);
};

// --- putting it on the page ------------------------------------------------------

/**
 * @param {object} options onUndo(), onJump(sprite, ids), onNote(text, about)
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
    head.appendChild(el('span', 'fw-grow', 'What Claude is doing'));
    const replayButton = el('button', '', '▶ Replay');
    replayButton.title = 'Play back the pictures of the game being built';
    replayButton.addEventListener('click', e => {
        e.stopPropagation();
        replay();
    });
    head.appendChild(replayButton);
    const toggle = el('span', '', '–');
    head.appendChild(toggle);
    head.title = 'Show or hide what Claude is doing';
    head.addEventListener('click', () => {
        collapsed = !collapsed;
        strip.classList.toggle('fw-collapsed', collapsed);
        toggle.textContent = collapsed ? '+' : '–';
    });
    strip.appendChild(head);
    planBox = el('div', 'fw-live-plan');
    strip.appendChild(planBox);
    narrationBox = el('div', 'fw-live-say');
    strip.appendChild(narrationBox);
    list = el('ul', 'fw-live-list');
    strip.appendChild(list);

    const note = el('div', 'fw-live-note');
    noteInput = el('input');
    noteInput.placeholder = 'Tell Claude something…';
    noteInput.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') sendNote();
    });
    const pin = el('button', '', '📍');
    pin.title = 'Point the note at a sprite or a place on the stage';
    let stopPointing = null;
    pin.addEventListener('click', () => {
        if (pointing && stopPointing) {
            stopPointing();
            noteStatus.textContent = '';
        } else {
            stopPointing = startPointing(pin);
        }
    });
    const send = el('button', '', 'Send');
    send.addEventListener('click', sendNote);
    noteStatus = el('div', 'fw-note-status');
    note.appendChild(noteInput);
    note.appendChild(pin);
    note.appendChild(send);
    note.appendChild(noteStatus);
    strip.appendChild(note);
    document.body.appendChild(strip);

    keysBox = el('div', 'fw-keys fw-hidden');
    document.body.appendChild(keysBox);

    place();
    window.addEventListener('resize', place);
    // The editor's layout changes without telling anyone (stage size,
    // tabs), so the overlays follow it, and the times stay fresh.
    setInterval(() => {
        place();
        refreshTimes();
    }, 1000);
};

// --- what a request looks like in the timeline ------------------------------------

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
            return {icon: '✏️',
                text: `${sprite}: Claude's code had a mistake${line}, fixing it`,
                tone: 'bad',
                sprite};
        }
        if (!result.changed) return {icon: '✏️', text: `${sprite}: no change`, tone: 'dim', sprite};
        return {icon: '✏️',
            text: `wrote ${sprite}${result.summary ? `: ${result.summary}` : ''}`,
            sprite,
            ids: result.changedIds,
            undo: true};
    case 'checkText':
        return {icon: '🧪', text: `checked code for ${sprite}${result.ok ? '' : ': a mistake'}`, tone: 'dim', sprite};
    case 'readSprite': return {icon: '👀', text: `read ${sprite}`, tone: 'dim', sprite};
    case 'undo': return {icon: '↩️', text: `undid ${result.sprite || 'the last write'}`, sprite: result.sprite};
    case 'createSprite': return {icon: '✨', text: `made sprite ${result.name || params.name}`, sprite: result.name};
    case 'deleteSprite': return {icon: '🗑️', text: `deleted ${sprite}`};
    case 'renameSprite': return {icon: '🏷️', text: `renamed ${sprite} to ${params.name}`, sprite: params.name};
    case 'addCostume':
        return {icon: '🎨', text: `drew ${result.costume ? `"${result.costume.name}"` : 'a costume'} for ${sprite}`};
    case 'replaceCostume':
        return {icon: '🎨', text: `redrew ${result.costume ? `"${result.costume.name}"` : 'a costume'} in ${sprite}`};
    case 'previewImage': return {icon: '🎨', text: 'tried a drawing', tone: 'dim'};
    case 'costumeSheet': return {icon: '🖼️', text: `looked at ${sprite}'s costumes`, tone: 'dim'};
    case 'tidyScripts': return {icon: '🧹', text: `tidied ${sprite}'s scripts`, sprite};
    case 'addSound': {
        const name = result.sound ? result.sound.name : params.name;
        return {icon: '🔊', text: `made the sound "${name}" for ${sprite}`};
    }
    case 'playSound': return {icon: '🔊', text: `played "${params.sound}"`, tone: 'dim'};
    case 'rename': return {icon: '🏷️', text: `renamed ${params.kind} "${params.from}" to "${params.to}"`};
    case 'performance': return {icon: '⏱️', text: 'measured how fast the game runs'};
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
    case 'stepFrames': return {icon: '⏯️', text: `ran ${params.frames || 1} frame(s)`, tone: 'dim'};
    case 'freeze': return {icon: params.frozen ? '⏸️' : '▶️', text: params.frozen ? 'paused' : 'resumed', tone: 'dim'};
    case 'screenshot': return {icon: '📸', text: 'looked at the stage', tone: 'dim'};
    case 'state': return {icon: '📊', text: 'checked the game state', tone: 'dim'};
    case 'answer': return {icon: '💬', text: `answered "${params.text}"`};
    case 'health': return {icon: '🩺', text: 'ran the health check', tone: 'dim'};
    case 'fixHealth': return {icon: '🩺', text: 'fixed what the health check found'};
    case 'gameOptions': return {icon: '⚙️', text: 'changed game options', tone: 'dim'};
    case 'setVariable': return {icon: '🔧', text: `set ${params.name} to ${JSON.stringify(params.value)}`, tone: 'dim'};
    case 'saveProject': return {icon: '💾', text: 'saved the project'};
    case 'saveFilesPart': return result.done ? {icon: '💾', text: 'saved the project'} :
        (failed ? {icon: '⚠️', text: 'saving did not work', tone: 'bad'} : null);
    case 'saveFilesStart': return failed ? {icon: '⚠️', text: 'saving did not work', tone: 'bad'} : null;
    case 'loadProject': return {icon: '📂', text: 'opened a project'};
    default:
        return failed ? {icon: '⚠️', text: `${method} did not work`, tone: 'bad'} : null;
    }
};
