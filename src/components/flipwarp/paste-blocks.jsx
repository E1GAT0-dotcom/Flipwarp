import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import VM from 'scratch-vm';

import {pasteText} from '../../lib/flipwarp/project-text.js';
import {ParseError} from '../../lib/flipwarp/hints.js';
import {currentStyle} from '../../lib/flipwarp/settings.js';
import styles from './paste-blocks.css';

/**
 * The box that turns text into blocks.
 *
 * Deliberately a box you can see rather than a straight read of the clipboard.
 * Three reasons, and the first is the one that matters: text pasted from
 * somewhere else is very often not quite right, and a mistake shown next to
 * the line it is on can be fixed here instead of sending you back to whatever
 * you copied it from. The others are that Firefox will not let a page read the
 * clipboard at all, and that Chrome asks permission first — neither is a good
 * moment for a feature to simply do nothing.
 *
 * The clipboard is still used where it is allowed, so the usual case is the
 * box opening with the text already in it and one button left to press.
 */
class PasteBlocks extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleChange', 'handleAdd', 'handleKeyDown', 'setTextarea']);
        this.textarea = null;
        // Set the moment the person types. The clipboard may still be being
        // read at that point, and whatever it comes back with must not land
        // on top of what they wrote.
        this.touched = false;
        this.state = {
            text: '',
            error: null,
            reading: true
        };
    }

    componentDidMount () {
        document.addEventListener('keydown', this.handleKeyDown, true);
        this.readClipboard();
    }

    componentWillUnmount () {
        document.removeEventListener('keydown', this.handleKeyDown, true);
        clearTimeout(this.giveUp);
    }

    readClipboard () {
        let settled = false;
        const done = text => {
            if (settled) return;
            settled = true;
            clearTimeout(this.giveUp);
            if (this.touched) {
                this.setState({reading: false});
                return;
            }
            this.setState({text: text || '', reading: false}, () => {
                if (this.textarea) {
                    this.textarea.focus();
                    this.textarea.select();
                }
            });
        };

        // The box is usable with nothing in it, so nothing here is allowed to
        // hold it shut. A browser asking permission to read the clipboard can
        // leave the promise unsettled for as long as the person ignores the
        // prompt — and in some setups forever — so the wait is capped and the
        // empty box is the answer.
        this.giveUp = setTimeout(() => done(''), 1200);

        if (!navigator.clipboard || !navigator.clipboard.readText) {
            done('');
            return;
        }
        // A refusal is the ordinary case, not a fault: the browser is allowed
        // to say no, and Firefox always does.
        try {
            navigator.clipboard.readText().then(done, () => done(''));
        } catch (e) {
            done('');
        }
    }

    setTextarea (el) {
        this.textarea = el;
    }

    handleKeyDown (e) {
        if (e.key === 'Escape') {
            e.stopPropagation();
            this.props.onClose();
        }
    }

    handleChange (e) {
        this.touched = true;
        this.setState({text: e.target.value, error: null});
    }

    handleAdd () {
        const text = this.state.text;
        if (!text.trim()) {
            this.setState({error: {message: 'There is nothing here to add.', fix: null, line: null}});
            return;
        }
        try {
            const {scripts, created} = pasteText(this.props.vm, text, this.props.at);
            this.props.onDone(scripts, created);
        } catch (e) {
            this.setState({error: toError(e)});
        }
    }

    render () {
        const {text, error, reading} = this.state;
        const style = currentStyle();
        return (
            <div
                className={styles.overlay}
                onClick={this.props.onClose}
            >
                <div
                    className={styles.window}
                    onClick={e => e.stopPropagation()}
                >
                    <div className={styles.head}>
                        <span className={styles.title}>{'Paste as blocks'}</span>
                        <button
                            className={styles.close}
                            onClick={this.props.onClose}
                        >{'✕'}</button>
                    </div>

                    <div className={styles.body}>
                        <textarea
                            className={styles.editor}
                            placeholder={reading ? 'Reading the clipboard…' : `Paste ${style.label} text here.`}
                            ref={this.setTextarea}
                            spellCheck={false}
                            value={text}
                            onChange={this.handleChange}
                        />

                        {error ? (
                            <div className={styles.error}>
                                <div className={styles.errorLine}>
                                    {error.line ? `Line ${error.line}: ${error.message}` : error.message}
                                </div>
                                {error.fix ? <div>{`Try this: ${error.fix}`}</div> : null}
                            </div>
                        ) : null}

                        <div className={styles.foot}>
                            {/* Which style is being read matters here in a way
                                it does not elsewhere: text copied while the
                                other one was on will not go back in. */}
                            <span className={styles.note}>
                                {`Read as ${style.label}. The scripts are added to this sprite — nothing already in it is removed.`}
                            </span>
                            <button
                                className={styles.add}
                                onClick={this.handleAdd}
                            >{'Add to this sprite'}</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

const toError = e => {
    if (e instanceof ParseError) {
        return {line: e.line, message: e.message, fix: e.fix || null};
    }
    return {line: null, message: e && e.message ? e.message : String(e), fix: null};
};

PasteBlocks.propTypes = {
    at: PropTypes.shape({x: PropTypes.number, y: PropTypes.number}),
    vm: PropTypes.instanceOf(VM).isRequired,
    onClose: PropTypes.func.isRequired,
    onDone: PropTypes.func.isRequired
};

export default PasteBlocks;
