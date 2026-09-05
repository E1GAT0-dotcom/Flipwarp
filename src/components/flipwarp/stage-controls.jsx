import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';

import {keysUsed, asEvent, labelFor, ARROWS} from '../../lib/flipwarp/project-keys.js';
import styles from './stage-controls.css';

/**
 * Buttons over the stage, for projects that expect a keyboard.
 *
 * A phone has no arrow keys, so a project built around them cannot be played
 * on one at all — not badly, not at all. These are the keys that project asks
 * about, read off its own blocks, laid over the stage: the arrows as a pad
 * where a thumb expects them and everything else as buttons on the other side.
 *
 * Only the keys the project actually uses. A fixed pad would cover a quarter
 * of the stage of a game played entirely with the mouse.
 *
 * They send what a real keyboard sends, so nothing downstream knows the
 * difference, and they hold: a finger held on the pad is a key held down,
 * which is what a project that moves a sprite while a key is pressed needs.
 */
class StageControls extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleDown', 'handleUp', 'refresh']);
        this.held = new Map();
        this.state = {keys: []};
    }
    componentDidMount () {
        this.refresh();
        // The keys a project uses change as it is written, and it is written
        // in the same window it is played in.
        this.props.vm.on('workspaceUpdate', this.refresh);
        this.props.vm.on('targetsUpdate', this.refresh);
    }
    componentWillUnmount () {
        this.props.vm.off('workspaceUpdate', this.refresh);
        this.props.vm.off('targetsUpdate', this.refresh);
        this.releaseAll();
    }
    refresh () {
        const keys = keysUsed(this.props.vm).filter(key => asEvent(key));
        // Same set, same order: leave the buttons alone rather than rebuilding
        // them under a finger that is holding one down.
        const same = keys.length === this.state.keys.length &&
            keys.every(key => this.state.keys.includes(key));
        if (!same) this.setState({keys});
    }
    post (scratchKey, isDown) {
        const event = asEvent(scratchKey);
        if (!event) return;
        this.props.vm.postIOData('keyboard', {
            key: event.key,
            keyCode: event.keyCode,
            isDown
        });
    }
    releaseAll () {
        for (const scratchKey of this.held.keys()) this.post(scratchKey, false);
        this.held.clear();
    }
    handleDown (e) {
        const scratchKey = e.currentTarget.dataset.key;
        // Stops the press turning into a scroll, a text selection, or the
        // magnifying glass a long press puts up on a phone.
        e.preventDefault();
        if (this.held.has(scratchKey)) return;
        this.held.set(scratchKey, true);
        // A finger that slides off the button still has to let go of the key,
        // and a pointer that has been captured keeps sending its events here
        // wherever it goes.
        if (e.currentTarget.setPointerCapture && typeof e.pointerId === 'number') {
            try {
                e.currentTarget.setPointerCapture(e.pointerId);
            } catch (err) {
                // Not every browser will, and it still works without.
            }
        }
        this.post(scratchKey, true);
    }
    handleUp (e) {
        const scratchKey = e.currentTarget.dataset.key;
        if (!this.held.has(scratchKey)) return;
        this.held.delete(scratchKey);
        this.post(scratchKey, false);
    }
    renderKey (scratchKey, className) {
        return (
            <button
                className={className}
                data-key={scratchKey}
                key={scratchKey}
                onPointerCancel={this.handleUp}
                onPointerDown={this.handleDown}
                onPointerUp={this.handleUp}
            >{labelFor(scratchKey)}</button>
        );
    }
    render () {
        const {keys} = this.state;
        if (!keys.length) return null;
        const arrows = ARROWS.filter(key => keys.includes(key));
        const others = keys.filter(key => !ARROWS.includes(key));
        return (
            <div className={styles.controls}>
                {arrows.length ? (
                    <div className={styles.pad}>
                        {ARROWS.map(key => (arrows.includes(key) ?
                            this.renderKey(key, `${styles.key} ${styles[key.split(' ')[0]]}`) :
                            <span
                                className={styles.gap}
                                key={key}
                            />
                        ))}
                    </div>
                ) : <span />}
                {others.length ? (
                    <div className={styles.buttons}>
                        {others.map(key => this.renderKey(key, `${styles.key} ${styles.round}`))}
                    </div>
                ) : null}
            </div>
        );
    }
}

StageControls.propTypes = {
    vm: PropTypes.instanceOf(VM).isRequired
};

export default StageControls;
