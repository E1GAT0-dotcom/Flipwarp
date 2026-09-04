// The project-wide tools: search, find and replace, and the block sheet.
//
// They share one panel because they share one idea — the project as text,
// rather than the sprite you happen to be looking at. Each one can be turned
// off under Advanced, and a panel with nothing turned on never appears.

import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import VM from 'scratch-vm';

import {findInProject, planReplace, applyReplacements, revealScript} from '../../lib/flipwarp/project-text.js';
import {BLOCKS} from '../../lib/flipwarp/phrasebook.js';
import {currentStyle} from '../../lib/flipwarp/settings.js';
import styles from './flipwarp-tools.css';

// The block sheet is built from the phrasebook itself, so it cannot fall out
// of step with what the editor actually accepts — and it is built per style,
// because a sheet showing a spelling the editor would reject is worse than no
// sheet at all.
const sheetCache = new Map();
const sheetFor = style => {
    if (sheetCache.has(style.id)) return sheetCache.get(style.id);
    const spell = op => (op === '&&' ? style.andWord : op === '||' ? style.orWord : op);
    const body = style.indentBased ? ':' : ' { … }';
    const sheet = Object.entries(BLOCKS)
        .filter(([, block]) => !block.hidden)
        .map(([opcode, block]) => {
            const name = style.blockName(block.name);
            return {
                opcode,
                name,
                kind: block.kind,
                // How you would write it: the name, then its inputs in order.
                form: block.infix ?
                    `a ${spell(block.infix)} b` :
                    `${name}(${(block.args || []).join(', ')})${block.substack ? body : ''}`,
                category: opcode.split('_')[0]
            };
        })
        .sort((a, b) => (a.category === b.category ?
            a.name.localeCompare(b.name) :
            a.category.localeCompare(b.category)));
    sheetCache.set(style.id, sheet);
    return sheet;
};

const describe = e => (e && e.message ? e.message : String(e));

// A rename and an edited line are different things and are counted
// separately: renaming a variable changes every block that uses it without
// any line being rewritten, and saying "nothing changed" there would be a lie.
const describeResult = (result, deleting) => {
    const parts = [];
    if (result.renamed) {
        parts.push(`renamed ${result.renamed} ${result.renamed === 1 ? 'variable' : 'variables'} everywhere`);
    }
    if (result.lines) {
        parts.push(`${deleting ? 'deleted' : 'changed'} ${result.lines} ` +
            `${result.lines === 1 ? 'block' : 'blocks'} in ` +
            `${result.sprites} ${result.sprites === 1 ? 'sprite' : 'sprites'}`);
    }
    if (!parts.length) return 'Nothing changed.';
    return `${parts.join(', ')}.`.replace(/^./, c => c.toUpperCase());
};

const KIND_LABEL = {
    statement: 'does something',
    c: 'wraps other blocks',
    terminal: 'stops here',
    hat: 'starts a script',
    reporter: 'reports a value',
    boolean: 'answers yes or no'
};

class FlipwarpTools extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleSearch', 'handlePreview', 'handleApply', 'handleClose',
            'handleNext', 'handlePrevious', 'handleQueryKey']);
        this.state = {
            mode: props.settings.searchProject ? 'search' : (props.settings.findReplace ? 'replace' : 'sheet'),
            query: '',
            replacement: '',
            caseSensitive: false,
            wholeWord: false,
            matches: null,
            // Which match the arrows are on. Kept so the panel can be walked
            // through without being closed and reopened for every one.
            current: -1,
            unreadable: [],
            chosen: {},
            wholeBlock: false,
            sheetQuery: '',
            status: '',
            error: null,
            busy: false
        };
    }

    handleClose () {
        this.props.onClose();
    }

    handleSearch () {
        try {
            const {matches, unreadable} = findInProject(this.props.vm, this.state.query, {
                caseSensitive: this.state.caseSensitive,
                wholeWord: this.state.wholeWord
            });
            this.setState({
                matches,
                unreadable,
                error: null,
                chosen: {},
                current: -1,
                status: `${matches.length} ${matches.length === 1 ? 'line' : 'lines'}`
            }, () => {
                // Straight to the first one, because that is what pressing
                // Find is asking for.
                if (matches.length) this.goTo(0);
            });
        } catch (e) {
            this.setState({error: describe(e), matches: null});
        }
    }

    handlePreview () {
        try {
            const {matches, unreadable} = planReplace(
                this.props.vm, this.state.query, this.state.replacement, {
                    caseSensitive: this.state.caseSensitive,
                    wholeWord: this.state.wholeWord,
                    wholeBlock: this.state.wholeBlock
                });
            // Everything found starts ticked; untick what you do not want.
            const chosen = {};
            for (const m of matches) chosen[m.id] = true;
            const verb = this.state.wholeBlock ? 'would be deleted' : 'would change';
            this.setState({
                matches,
                unreadable,
                chosen,
                error: null,
                current: -1,
                status: `${matches.length} ${matches.length === 1 ? 'line' : 'lines'} ${verb}`
            });
        } catch (e) {
            this.setState({error: describe(e), matches: null});
        }
    }

    handleApply () {
        const chosen = Object.keys(this.state.chosen).filter(id => this.state.chosen[id]);
        if (!chosen.length) return;
        this.setState({busy: true, error: null});
        try {
            const result = applyReplacements(
                this.props.vm, this.state.query, this.state.replacement, chosen, {
                    caseSensitive: this.state.caseSensitive,
                    wholeWord: this.state.wholeWord,
                    wholeBlock: this.state.wholeBlock
                });
            this.setState({
                busy: false,
                matches: null,
                chosen: {},
                current: -1,
                status: describeResult(result, this.state.wholeBlock)
            });
        } catch (e) {
            // Nothing was applied — the build failed before any sprite was
            // touched — so say what went wrong and leave the list up.
            this.setState({busy: false, error: describe(e), status: 'Nothing was changed.'});
        }
    }

    // Walking the results. The panel stays open the whole time — having to
    // close and reopen it for every hit was the whole complaint.
    goTo (index) {
        const matches = this.state.matches;
        if (!matches || !matches.length) return;
        const wrapped = ((index % matches.length) + matches.length) % matches.length;
        const match = matches[wrapped];
        this.setState({current: wrapped});
        revealScript(this.props.vm, match.sprite, match.script);
    }

    handleNext () {
        this.goTo(this.state.current + 1);
    }

    handlePrevious () {
        this.goTo(this.state.current - 1);
    }

    // Enter searches, and searching again steps on to the next one — which is
    // what Enter does in every other find box there is.
    handleQueryKey (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (this.state.matches && this.state.matches.length) this.handleNext();
        else if (this.state.mode === 'search') this.handleSearch();
        else this.handlePreview();
    }

    renderSteps () {
        const {matches, current} = this.state;
        if (!matches || !matches.length) return null;
        return (
            <div className={styles.steps}>
                <button
                    className={styles.step}
                    title="Previous"
                    onClick={this.handlePrevious}
                >{'\u2039'}</button>
                <span className={styles.stepCount}>
                    {`${current < 0 ? '\u2013' : current + 1} of ${matches.length}`}
                </span>
                <button
                    className={styles.step}
                    title="Next"
                    onClick={this.handleNext}
                >{'\u203a'}</button>
            </div>
        );
    }

    renderOptions () {
        return (
            <div className={styles.options}>
                <label>
                    <input
                        checked={this.state.caseSensitive}
                        type="checkbox"
                        onChange={e => this.setState({caseSensitive: e.target.checked, matches: null})}
                    />
                    {' Match capitals'}
                </label>
                <label>
                    <input
                        checked={this.state.wholeWord}
                        type="checkbox"
                        onChange={e => this.setState({wholeWord: e.target.checked, matches: null})}
                    />
                    {' Whole word only'}
                </label>
                {this.state.mode === 'replace' ? (
                    <label>
                        <input
                            checked={this.state.wholeBlock}
                            type="checkbox"
                            onChange={e => this.setState({wholeBlock: e.target.checked, matches: null})}
                        />
                        {' Delete the whole block'}
                    </label>
                ) : null}
            </div>
        );
    }

    renderMatches (withPreview) {
        const {matches, unreadable} = this.state;
        if (!matches) return null;
        if (!matches.length) {
            return <div className={styles.empty}>{'Nothing found.'}</div>;
        }
        return (
            <div className={styles.results}>
                {matches.map((m, index) => (
                    <div
                        className={`${styles.result} ${index === this.state.current ? styles.currentResult : ''}`}
                        key={m.id || `${m.sprite}:${m.line}`}
                    >
                        {withPreview ? (
                            <input
                                checked={!!this.state.chosen[m.id]}
                                type="checkbox"
                                onChange={e => this.setState(old => ({
                                    chosen: {...old.chosen, [m.id]: e.target.checked}
                                }))}
                            />
                        ) : null}
                        <button
                            className={`${styles.where} ${index === this.state.current ? styles.currentWhere : ''}`}
                            title={`Show this in ${m.sprite}`}
                            onClick={() => this.goTo(index)}
                        >{`${m.sprite}:${m.line}`}</button>
                        <div className={styles.lines}>
                            <code className={withPreview && (m.deletes || m.after !== m.text) ?
                                styles.before : ''}
                            >{m.text}</code>
                            {withPreview && m.cannotDelete ? (
                                <code className={styles.kept}>{`kept — ${m.cannotDelete}`}</code>
                            ) : null}
                            {withPreview && m.deletes ? (
                                <code className={styles.after}>{'deleted, with anything inside it'}</code>
                            ) : null}
                            {withPreview && !m.deletes && !m.cannotDelete && m.after !== m.text ? (
                                <code className={styles.after}>{m.after}</code>
                            ) : null}
                        </div>
                    </div>
                ))}
                {unreadable.length ? (
                    <div className={styles.note}>
                        {`Not searched, because ${unreadable.length === 1 ? 'it uses' : 'they use'} ` +
                         `blocks with no text form: ${unreadable.map(u => u.name).join(', ')}`}
                    </div>
                ) : null}
            </div>
        );
    }

    renderSheet () {
        const q = this.state.sheetQuery.trim().toLowerCase();
        const sheet = sheetFor(currentStyle());
        const rows = q ?
            sheet.filter(row => row.name.toLowerCase().includes(q) ||
                row.opcode.toLowerCase().includes(q) ||
                row.form.toLowerCase().includes(q)) :
            sheet;
        return (
            <React.Fragment>
                <div className={styles.row}>
                    <input
                        className={styles.input}
                        placeholder="Search the blocks"
                        value={this.state.sheetQuery}
                        onChange={e => this.setState({sheetQuery: e.target.value})}
                    />
                    <span className={styles.status}>{`${rows.length} of ${sheet.length}`}</span>
                </div>
                <div className={styles.results}>
                    {rows.map(row => (
                        <div
                            className={styles.sheetRow}
                            key={row.opcode}
                        >
                            <code className={styles.form}>{row.form}</code>
                            <span className={styles.kind}>{KIND_LABEL[row.kind] || row.kind}</span>
                        </div>
                    ))}
                </div>
            </React.Fragment>
        );
    }

    render () {
        const {settings} = this.props;
        const {mode, busy} = this.state;
        const tabs = [
            settings.searchProject ? ['search', 'Search all sprites'] : null,
            settings.findReplace ? ['replace', 'Find and replace'] : null,
            settings.blockSheet ? ['sheet', 'Block sheet'] : null
        ].filter(Boolean);
        if (!tabs.length) return null;
        const current = tabs.some(t => t[0] === mode) ? mode : tabs[0][0];

        return (
            <div className={styles.overlay}>
                <div className={styles.window}>
                    <div className={styles.head}>
                        {tabs.map(([id, label]) => (
                            <button
                                className={`${styles.tab} ${current === id ? styles.tabActive : ''}`}
                                key={id}
                                onClick={() => this.setState({mode: id, matches: null, status: '', error: null})}
                            >{label}</button>
                        ))}
                        <button
                            className={styles.close}
                            title="Close"
                            onClick={this.handleClose}
                        >{'✕'}</button>
                    </div>

                    <div className={styles.body}>
                        {current === 'sheet' ? this.renderSheet() : (
                            <React.Fragment>
                                <div className={styles.row}>
                                    <input
                                        autoFocus
                                        className={styles.input}
                                        placeholder={current === 'search' ? 'Find in every sprite' : 'Find'}
                                        value={this.state.query}
                                        onChange={e => this.setState({query: e.target.value, matches: null})}
                                        onKeyDown={this.handleQueryKey}
                                    />
                                    {current === 'replace' && !this.state.wholeBlock ? (
                                        <input
                                            className={styles.input}
                                            placeholder="Replace with"
                                            value={this.state.replacement}
                                            onChange={e => this.setState({
                                                replacement: e.target.value, matches: null
                                            })}
                                        />
                                    ) : null}
                                    {this.renderSteps()}
                                    <button
                                        className={styles.go}
                                        disabled={!this.state.query || busy}
                                        onClick={current === 'search' ? this.handleSearch : this.handlePreview}
                                    >{current === 'search' ? 'Find' : 'Preview'}</button>
                                </div>

                                {this.renderOptions()}

                                {this.state.error ? (
                                    <div className={styles.error}>{this.state.error}</div>
                                ) : null}

                                {this.renderMatches(current === 'replace')}

                                <div className={styles.foot}>
                                    <span className={styles.status}>{this.state.status}</span>
                                    {current === 'replace' && this.state.matches && this.state.matches.length ? (
                                        <button
                                            className={styles.apply}
                                            disabled={busy}
                                            onClick={this.handleApply}
                                        >{'Replace the ticked lines'}</button>
                                    ) : null}
                                </div>
                            </React.Fragment>
                        )}
                    </div>
                </div>
            </div>
        );
    }
}

FlipwarpTools.propTypes = {
    onClose: PropTypes.func.isRequired,
    settings: PropTypes.shape({
        searchProject: PropTypes.bool,
        findReplace: PropTypes.bool,
        blockSheet: PropTypes.bool
    }).isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default FlipwarpTools;
