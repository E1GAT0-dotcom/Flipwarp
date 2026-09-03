// The project-wide tools: search, find and replace, and the block sheet.
//
// They share one panel because they share one idea — the project as text,
// rather than the sprite you happen to be looking at. Each one can be turned
// off under Advanced, and a panel with nothing turned on never appears.

import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import VM from 'scratch-vm';

import {findInProject, planReplace, applyReplacements, openSprite} from '../../lib/flipwarp/project-text.js';
import {BLOCKS} from '../../lib/flipwarp/phrasebook.js';
import styles from './flipwarp-tools.css';

// The block sheet is built from the phrasebook itself, so it cannot fall out
// of step with what the editor actually accepts.
const SHEET = Object.entries(BLOCKS)
    .filter(([, block]) => !block.hidden)
    .map(([opcode, block]) => ({
        opcode,
        name: block.name,
        kind: block.kind,
        // How you would write it: the name, then its inputs in order.
        form: block.infix ?
            `a ${block.infix} b` :
            `${block.name}(${(block.args || []).join(', ')})${block.substack ? ' { … }' : ''}`,
        category: opcode.split('_')[0]
    }))
    .sort((a, b) => (a.category === b.category ?
        a.name.localeCompare(b.name) :
        a.category.localeCompare(b.category)));

const describe = e => (e && e.message ? e.message : String(e));

// A rename and an edited line are different things and are counted
// separately: renaming a variable changes every block that uses it without
// any line being rewritten, and saying "nothing changed" there would be a lie.
const describeResult = result => {
    const parts = [];
    if (result.renamed) {
        parts.push(`renamed ${result.renamed} ${result.renamed === 1 ? 'variable' : 'variables'} everywhere`);
    }
    if (result.lines) {
        parts.push(`changed ${result.lines} ${result.lines === 1 ? 'line' : 'lines'} in ` +
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
        bindAll(this, ['handleSearch', 'handlePreview', 'handleApply', 'handleClose']);
        this.state = {
            mode: props.settings.searchProject ? 'search' : (props.settings.findReplace ? 'replace' : 'sheet'),
            query: '',
            replacement: '',
            caseSensitive: false,
            wholeWord: false,
            matches: null,
            unreadable: [],
            chosen: {},
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
                status: `${matches.length} ${matches.length === 1 ? 'line' : 'lines'}`
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
                    wholeWord: this.state.wholeWord
                });
            // Everything found starts ticked; untick what you do not want.
            const chosen = {};
            for (const m of matches) chosen[m.id] = true;
            this.setState({
                matches,
                unreadable,
                chosen,
                error: null,
                status: `${matches.length} ${matches.length === 1 ? 'line' : 'lines'} would change`
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
                    wholeWord: this.state.wholeWord
                });
            this.setState({
                busy: false,
                matches: null,
                chosen: {},
                status: describeResult(result)
            });
        } catch (e) {
            // Nothing was applied — the build failed before any sprite was
            // touched — so say what went wrong and leave the list up.
            this.setState({busy: false, error: describe(e), status: 'Nothing was changed.'});
        }
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
                {matches.map(m => (
                    <div
                        className={styles.result}
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
                            className={styles.where}
                            title={`Open ${m.sprite}`}
                            onClick={() => {
                                openSprite(this.props.vm, m.sprite);
                                this.handleClose();
                            }}
                        >{`${m.sprite}:${m.line}`}</button>
                        <div className={styles.lines}>
                            <code className={withPreview ? styles.before : ''}>{m.text}</code>
                            {withPreview && m.after !== m.text ? (
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
        const rows = q ?
            SHEET.filter(row => row.name.toLowerCase().includes(q) ||
                row.opcode.toLowerCase().includes(q) ||
                row.form.toLowerCase().includes(q)) :
            SHEET;
        return (
            <React.Fragment>
                <div className={styles.row}>
                    <input
                        className={styles.input}
                        placeholder="Search the blocks"
                        value={this.state.sheetQuery}
                        onChange={e => this.setState({sheetQuery: e.target.value})}
                    />
                    <span className={styles.status}>{`${rows.length} of ${SHEET.length}`}</span>
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
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                if (current === 'search') this.handleSearch();
                                                else this.handlePreview();
                                            }
                                        }}
                                    />
                                    {current === 'replace' ? (
                                        <input
                                            className={styles.input}
                                            placeholder="Replace with"
                                            value={this.state.replacement}
                                            onChange={e => this.setState({
                                                replacement: e.target.value, matches: null
                                            })}
                                        />
                                    ) : null}
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
