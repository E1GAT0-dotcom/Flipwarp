import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import VM from 'scratch-vm';

import {
    readCurrentTarget,
    checkText,
    applyText,
    restoreBlocks,
    snapshotCurrentTarget,
    ParseError
} from '../../lib/flipwarp/vm-bridge.js';
import {BY_NAME} from '../../lib/flipwarp/phrasebook.js';
import {getSettings, onSettingsChanged, indentString, textOptions} from '../../lib/flipwarp/settings.js';
import {getStyle} from '../../lib/flipwarp/styles.js';
import {installDogeEasterEgg} from '../../lib/flipwarp/konami.js';
import FlipwarpTools from './flipwarp-tools.jsx';
import styles from './flipwarp-panel.css';

// Words that are part of the language rather than a block. The spelling of
// two of them follows the style; the rest are the same either way.
const keywordsFor = style => [
    'if', 'else', style.defineWord, 'variable', 'list', 'broadcast', 'global', 'as', 'fast',
    style.trueWord, style.falseWord
];
// Worked out once per style rather than on every keystroke: there are 226 of
// them and this runs while somebody is typing.
const nameCache = new Map();
const namesFor = style => {
    if (!nameCache.has(style.id)) nameCache.set(style.id, [...BY_NAME.keys()].map(n => style.blockName(n)));
    return nameCache.get(style.id);
};

const MAX_SUGGESTIONS = 8;
// Typing runs together into one undo step until you pause this long or move
// the caret, so Ctrl+Z steps back through edits rather than characters.
const UNDO_COALESCE_MS = 600;

/**
 * The blocks/text toggle. The editor looks like an ordinary block editor
 * until the button is pressed; pressing it lays the text over the workspace,
 * and pressing it again converts what you wrote back into blocks.
 */
class FlipwarpPanel extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleToggle',
            'handleTools',
            'handleApply',
            'handleRevert',
            'handleChange',
            'handleTargetsUpdate',
            'handleWorkspaceUpdate',
            'handleKeyDown',
            'handleGlobalKeyDown',
            'handleSelect',
            'setTextarea'
        ]);

        this.textarea = null;
        // The blocks as they were before the last conversion, so Ctrl+Z in
        // the workspace can put them back.
        this.blockUndo = null;
        this.expectOwnWorkspaceUpdate = false;
        // Text undo history, oldest first.
        this.history = [];
        this.historyIndex = -1;
        this.lastEditAt = 0;

        this.state = {
            open: false,
            tools: false,
            text: '',
            original: '',
            name: '',
            positions: [],
            blocks: 0,
            error: null,
            status: '',
            busy: false,
            settings: getSettings(),
            style: getStyle(getSettings().textStyle),
            suggestions: [],
            suggestIndex: 0
        };
        // The style this document was written in, which is the one it has to
        // be read back in.
        this.style = getStyle(getSettings().textStyle);
    }

    componentDidMount () {
        installDogeEasterEgg();
        this.props.vm.on('targetsUpdate', this.handleTargetsUpdate);
        this.props.vm.on('workspaceUpdate', this.handleWorkspaceUpdate);
        document.addEventListener('keydown', this.handleGlobalKeyDown, true);
        this.stopWatchingSettings = onSettingsChanged(settings => this.setState({settings}));
    }

    componentWillUnmount () {
        this.props.vm.off('targetsUpdate', this.handleTargetsUpdate);
        this.props.vm.off('workspaceUpdate', this.handleWorkspaceUpdate);
        document.removeEventListener('keydown', this.handleGlobalKeyDown, true);
        if (this.stopWatchingSettings) this.stopWatchingSettings();
    }

    // Any edit made in the workspace itself supersedes the last conversion,
    // so undoing it would no longer mean anything.
    handleWorkspaceUpdate () {
        if (this.expectOwnWorkspaceUpdate) {
            this.expectOwnWorkspaceUpdate = false;
            return;
        }
        this.blockUndo = null;
    }

    // Switching sprite while the text is open would leave you editing text
    // that belongs to a sprite you can no longer see, so re-read instead.
    handleTargetsUpdate () {
        if (!this.state.open || this.state.busy) return;
        const name = this.props.vm.editingTarget && this.props.vm.editingTarget.getName();
        if (name && name !== this.state.name) this.readTarget();
    }

    readTarget () {
        try {
            // The style is read once, here, and used for both directions of
            // this edit. Changing the setting while the text is open must not
            // leave a document written in one spelling and read in the other.
            const options = textOptions();
            this.style = options.style;
            const read = readCurrentTarget(this.props.vm, this.state.settings.showPositions, options);
            this.history = [{text: read.text, caret: 0}];
            this.historyIndex = 0;
            this.setState({
                text: read.text,
                original: read.text,
                positions: read.positions,
                name: read.isStage ? 'Stage' : read.name,
                blocks: read.blocks,
                error: null,
                status: '',
                suggestions: [],
                style: options.style
            });
        } catch (e) {
            this.setState({
                error: {message: describe(e), fix: null, snippet: null, line: null},
                text: '',
                original: '',
                suggestions: []
            });
        }
    }

    setTextarea (el) {
        this.textarea = el;
    }

    // The one button does both directions. Going to text just reads the
    // blocks; coming back converts what you wrote, and refuses to close if
    // the text has a mistake in it, so nothing is lost by switching away.
    handleTools () {
        this.setState(old => ({tools: !old.tools}));
    }

    handleToggle () {
        if (this.state.busy) return;
        if (this.state.open) {
            if (this.state.text === this.state.original) {
                this.setState({open: false, error: null, status: '', suggestions: []});
                return;
            }
            this.handleApply();
            return;
        }
        this.setState({open: true}, () => this.readTarget());
    }

    // ------------------------------------------------------------- undo

    pushHistory (text, caret, force) {
        const now = Date.now();
        const top = this.history[this.historyIndex];
        const runOn = !force && top && (now - this.lastEditAt) < UNDO_COALESCE_MS;
        this.lastEditAt = now;

        if (runOn) {
            this.history[this.historyIndex] = {text, caret};
            return;
        }
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push({text, caret});
        this.historyIndex = this.history.length - 1;
    }

    stepHistory (delta) {
        const next = this.historyIndex + delta;
        if (next < 0 || next >= this.history.length) return false;
        this.historyIndex = next;
        const entry = this.history[next];
        this.lastEditAt = 0;
        this.setState({text: entry.text, suggestions: [], error: null}, () => {
            if (this.textarea) {
                this.textarea.selectionStart = this.textarea.selectionEnd = entry.caret;
                this.textarea.focus();
            }
        });
        return true;
    }

    // Ctrl+Z outside the text panel undoes the last conversion, putting the
    // blocks back as they were. Blockly cannot see a conversion, so without
    // this the workspace's own undo would skip straight past it.
    handleGlobalKeyDown (e) {
        if (this.state.open) return;
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
        if (!this.blockUndo) return;

        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;

        e.preventDefault();
        e.stopPropagation();
        const undo = this.blockUndo;
        this.blockUndo = null;
        this.expectOwnWorkspaceUpdate = true;
        restoreBlocks(this.props.vm, undo.name, undo.blocks, undo.comments);
    }

    // ------------------------------------------------------- suggestions

    suggestionsFor (text, caret) {
        if (!this.state.settings.suggestions) return [];
        const before = text.slice(0, caret);
        const word = (/[A-Za-z_$][\w$.]*$/.exec(before) || [''])[0];
        if (word.length < 2) return [];

        // Names this project itself introduced: variables, lists, messages
        // from the header, and any custom block the text defines.
        const local = [];
        const declRe = /^\s*(?:global\s+)?(?:variable|list|broadcast)\s+([A-Za-z_$][\w$]*)/gm;
        const defRe = new RegExp(`^\\s*${this.style.defineWord}\\s+(?:fast\\s+)?([A-Za-z_$][\\w$]*)`, 'gm');
        let m;
        while ((m = declRe.exec(text))) local.push(m[1]);
        while ((m = defRe.exec(text))) local.push(m[1]);

        const lower = word.toLowerCase();
        const seen = new Set();
        return [...local, ...namesFor(this.style), ...keywordsFor(this.style)]
            .filter(n => {
                if (n === word || seen.has(n)) return false;
                if (!n.toLowerCase().startsWith(lower)) return false;
                seen.add(n);
                return true;
            })
            .sort((a, b) => a.length - b.length || a.localeCompare(b))
            .slice(0, MAX_SUGGESTIONS);
    }

    applySuggestion (name) {
        const el = this.textarea;
        if (!el) return;
        const caret = el.selectionStart;
        const before = el.value.slice(0, caret);
        const word = (/[A-Za-z_$][\w$.]*$/.exec(before) || [''])[0];
        const start = caret - word.length;
        const needsCall = namesFor(this.style).includes(name) && !keywordsFor(this.style).includes(name);
        const inserted = needsCall ? `${name}(` : name;
        const next = `${el.value.slice(0, start)}${inserted}${el.value.slice(el.selectionEnd)}`;
        this.pushHistory(next, start + inserted.length, true);
        this.setState({text: next, suggestions: []}, () => {
            el.selectionStart = el.selectionEnd = start + inserted.length;
            el.focus();
        });
    }

    // ------------------------------------------------------------ typing

    handleChange (e) {
        const text = e.target.value;
        const caret = e.target.selectionStart;
        this.pushHistory(text, caret);
        this.setState({
            text,
            status: '',
            error: null,
            suggestions: this.suggestionsFor(text, caret),
            suggestIndex: 0
        });
    }

    handleSelect (e) {
        // Moving the caret ends the current run of typing, and re-checks what
        // is worth suggesting where the caret now is.
        this.lastEditAt = 0;
        const suggestions = this.suggestionsFor(e.target.value, e.target.selectionStart);
        if (suggestions.length !== this.state.suggestions.length ||
            suggestions[0] !== this.state.suggestions[0]) {
            this.setState({suggestions, suggestIndex: 0});
        }
    }

    // Types over the current selection and puts the caret where `caret` says,
    // measured from the start of what was inserted.
    replaceSelection (el, inserted, caret) {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const next = `${el.value.slice(0, start)}${inserted}${el.value.slice(end)}`;
        const pos = start + (caret === undefined ? inserted.length : caret);
        this.pushHistory(next, pos, true);
        this.setState({text: next, suggestions: []}, () => {
            el.selectionStart = el.selectionEnd = pos;
        });
    }

    handleKeyDown (e) {
        const el = e.target;
        const {suggestions, suggestIndex} = this.state;
        const step = indentString();

        // Undo and redo inside the text.
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            this.stepHistory(e.shiftKey ? 1 : -1);
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            this.stepHistory(1);
            return;
        }

        // While a suggestion is showing, the arrows and Tab belong to it.
        if (suggestions.length) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.setState({suggestIndex: (suggestIndex + 1) % suggestions.length});
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.setState({suggestIndex: (suggestIndex - 1 + suggestions.length) % suggestions.length});
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                this.setState({suggestions: []});
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                this.applySuggestion(suggestions[suggestIndex]);
                return;
            }
        }

        // Tab indents rather than leaving the editor, which is what anyone
        // typing code expects.
        if (e.key === 'Tab') {
            e.preventDefault();
            this.replaceSelection(el, step);
            return;
        }

        // Enter carries the current line's indent down with it, and adds a
        // step after whatever starts a body, so a nested line does not start
        // back at the left margin.
        if (e.key === 'Enter' && !e.shiftKey) {
            const before = el.value.slice(0, el.selectionStart);
            const line = before.slice(before.lastIndexOf('\n') + 1);
            const indent = (/^[ \t]*/.exec(line) || [''])[0];
            const opensBlock = this.style.indentBased ? /:\s*$/.test(line) : /\{\s*$/.test(line);
            const nextChar = el.value.slice(el.selectionEnd, el.selectionEnd + 1);

            e.preventDefault();
            // Typing between a brace pair puts the closing one on its own
            // line. An indentation-based style has no closing line to move.
            if (opensBlock && nextChar === '}' && !this.style.indentBased) {
                const inner = `${indent}${step}`;
                this.replaceSelection(el, `\n${inner}\n${indent}`, 1 + inner.length);
                return;
            }
            this.replaceSelection(el, `\n${indent}${opensBlock ? step : ''}`);
            return;
        }

        // Backspace at the front of an indented line goes back out one step
        // rather than eating a single space. In a bracket-based style the
        // indent is decoration and the closing brace does this job instead.
        if (e.key === 'Backspace' && this.style.indentBased &&
            el.selectionStart === el.selectionEnd && el.selectionStart > 0) {
            const before = el.value.slice(0, el.selectionStart);
            const line = before.slice(before.lastIndexOf('\n') + 1);
            if (line !== '' && /^[ \t]+$/.test(line) && line.length >= step.length) {
                e.preventDefault();
                const start = el.selectionStart - step.length;
                const next = `${el.value.slice(0, start)}${el.value.slice(el.selectionEnd)}`;
                this.pushHistory(next, start, true);
                this.setState({text: next, suggestions: []}, () => {
                    el.selectionStart = el.selectionEnd = start;
                });
                return;
            }
        }

        // A closing brace lines itself up with the line that opened it.
        if (e.key === '}' && !this.style.indentBased) {
            const before = el.value.slice(0, el.selectionStart);
            const line = before.slice(before.lastIndexOf('\n') + 1);
            if (/^[ \t]+$/.test(line) && line.length >= step.length) {
                e.preventDefault();
                const start = el.selectionStart - step.length;
                const next = `${el.value.slice(0, start)}}${el.value.slice(el.selectionEnd)}`;
                this.pushHistory(next, start + 1, true);
                this.setState({text: next, suggestions: []}, () => {
                    el.selectionStart = el.selectionEnd = start + 1;
                });
            }
        }
    }

    handleRevert () {
        this.pushHistory(this.state.original, 0, true);
        this.setState({text: this.state.original, error: null, status: '', suggestions: []});
    }

    async handleApply () {
        const {vm} = this.props;
        const text = this.state.text;

        // Check before touching the project, so a bad line changes nothing.
        try {
            checkText(vm, text, this.state.positions, this.style);
        } catch (e) {
            this.setState({error: toError(e), status: ''});
            return;
        }

        // Remember the blocks as they are, so Ctrl+Z can put them back.
        const before = snapshotCurrentTarget(vm);

        this.setState({busy: true, error: null, status: 'Converting…', suggestions: []});
        try {
            this.expectOwnWorkspaceUpdate = true;
            const result = await applyText(vm, text, this.state.positions, this.style);
            if (result.changed) this.blockUndo = before;
            const read = readCurrentTarget(vm, this.state.settings.showPositions, textOptions());
            this.setState({
                busy: false,
                open: false,
                text: read.text,
                original: read.text,
                positions: read.positions,
                blocks: result.blocks,
                status: '',
                error: null
            });
        } catch (e) {
            this.expectOwnWorkspaceUpdate = false;
            this.setState({busy: false, error: toError(e), status: ''});
        }
    }

    // The same two buttons wherever they are standing. Over the workspace they
    // float in the corner; over the text they belong in the strip at the
    // bottom, in line with Undo my edits, rather than hovering just above it.
    renderButtons (anyTool, open) {
        return (
            <React.Fragment>
                {anyTool ? (
                    <button
                        className={styles.toolsButton}
                        title="Search, replace, and the block sheet"
                        onClick={this.handleTools}
                    >
                        <Wrench />
                        {'Tools'}
                    </button>
                ) : null}
                <button
                    aria-pressed={open}
                    className={`${styles.toggleButton} ${open ? styles.active : ''}`}
                    title={open ? 'Convert this back into blocks' : 'See these blocks as text'}
                    onClick={this.handleToggle}
                >
                    <span
                        aria-hidden="true"
                        className={styles.toggleMark}
                    >{'⇄'}</span>
                    {open ? 'Blocks' : 'Text'}
                </button>
            </React.Fragment>
        );
    }

    render () {
        const {open, text, name, error, status, busy, suggestions, suggestIndex, settings} = this.state;
        const anyTool = settings.searchProject || settings.findReplace || settings.blockSheet;
        return (
            <React.Fragment>
                {open ? null : (
                    <div className={styles.toggleContainer}>
                        {this.renderButtons(anyTool, open)}
                    </div>
                )}

                {open ? (
                    <div className={styles.panel}>
                        <div className={styles.panelHead}>
                            <span className={styles.name}>{name}</span>
                            <span>{'as text'}</span>
                            <span className={styles.count}>{describeSize(text)}</span>
                        </div>

                        <textarea
                            className={styles.editor}
                            disabled={busy}
                            ref={this.setTextarea}
                            spellCheck={false}
                            value={text}
                            onChange={this.handleChange}
                            onKeyDown={this.handleKeyDown}
                            onSelect={this.handleSelect}
                        />

                        {suggestions.length ? (
                            <div className={styles.suggestions}>
                                <span className={styles.suggestionsHint}>{'Tab to fill'}</span>
                                {suggestions.map((s, i) => (
                                    <button
                                        className={`${styles.suggestion} ${i === suggestIndex ? styles.suggestionActive : ''}`}
                                        key={s}
                                        onMouseDown={ev => {
                                            ev.preventDefault();
                                            this.applySuggestion(s);
                                        }}
                                    >{s}</button>
                                ))}
                            </div>
                        ) : null}

                        {error ? (
                            <div className={styles.error}>
                                <div className={styles.errorLine}>
                                    {error.line ? `Line ${error.line}: ${error.message}` : error.message}
                                </div>
                                {error.fix ? (
                                    <div className={styles.errorFix}>{`Try this: ${error.fix}`}</div>
                                ) : null}
                                {error.snippet ? (
                                    <pre className={styles.errorSnippet}>{error.snippet}</pre>
                                ) : null}
                            </div>
                        ) : null}

                        <div className={styles.panelFoot}>
                            <button
                                className={styles.revertButton}
                                disabled={busy}
                                onClick={this.handleRevert}
                            >{'Undo my edits'}</button>
                            <span className={styles.status}>{status}</span>
                            <div className={styles.footButtons}>
                                {this.renderButtons(anyTool, open)}
                            </div>
                        </div>
                    </div>
                ) : null}

                {this.state.tools && anyTool ? (
                    <FlipwarpTools
                        settings={settings}
                        vm={this.props.vm}
                        onClose={this.handleTools}
                    />
                ) : null}
            </React.Fragment>
        );
    }
}

// Drawn here rather than kept as a file, because it is four strokes and
// belongs next to the button it labels. Takes the button's colour, so it
// follows the theme without anything else being told about it.
const Wrench = () => (
    <svg
        aria-hidden="true"
        height="15"
        viewBox="0 0 24 24"
        width="15"
    >
        <path
            d="M20.3 5.4a5.5 5.5 0 0 1-7.1 7.1L6 19.7a2.1 2.1 0 0 1-3-3l7.2-7.2a5.5 5.5 0 0 1 7.1-7.1l-3.4 3.4 2.9 2.9z"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
        />
    </svg>
);

const describe = e => (e && e.message ? e.message : String(e));

// In text mode the block count is not what you are looking at, so the header
// counts what is actually on screen.
const describeSize = text => {
    const lines = text === '' ? 0 : text.split('\n').length;
    const chars = text.length;
    return `${lines} ${lines === 1 ? 'line' : 'lines'}, ${chars} ${chars === 1 ? 'character' : 'characters'}`;
};

const toError = e => {
    if (e instanceof ParseError) {
        return {
            line: e.line,
            message: e.message,
            fix: e.fix || null,
            snippet: e.text ? e.text.trim() : null
        };
    }
    return {line: null, message: describe(e), fix: null, snippet: null};
};

FlipwarpPanel.propTypes = {
    vm: PropTypes.instanceOf(VM).isRequired
};

export default FlipwarpPanel;
