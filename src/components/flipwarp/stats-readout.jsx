import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';

import {getSettings, onSettingsChanged} from '../../lib/flipwarp/settings.js';
import styles from './stats-readout.css';

// How often the numbers are worked out. Every frame would make the frame rate
// figure jump about too much to read, and it would also be the readout itself
// making the project slower, which is the one thing a readout must not do.
const EVERY = 500;

/**
 * What the project is costing, in the corner of the stage.
 *
 * There is already a frame rate figure in the editor, but it says what the
 * framerate is set to, not what is happening, and those two are the same right
 * up until the moment you need to know. This says what is happening: frames a
 * second as counted, how long a frame is taking against how long it has, how
 * many scripts are running, and how many clones are about, which between them
 * name nearly every reason a project slows down.
 */
class StatsReadout extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleSettingsChange', 'sample', 'setElement']);
        this.frames = 0;
        this.countFrame = () => this.frames++;
        this.state = {
            shown: getSettings().statsReadout,
            fps: 0,
            target: 30,
            cost: 0,
            budget: 33,
            threads: 0,
            clones: 0,
            sprites: 0,
            skipped: 0,
            // Worked out from where the stage canvas actually is rather than
            // written into the stylesheet. The box this sits in is taller than
            // the stage in the editor, and a different shape again in full
            // screen and in an embed, so a fixed corner is the stage's corner
            // in one of those and floating in space in the others.
            place: {left: 6, top: 6}
        };
    }

    componentDidMount () {
        this.stopWatching = onSettingsChanged(this.handleSettingsChange);
        if (this.state.shown) this.start();
    }

    componentWillUnmount () {
        if (this.stopWatching) this.stopWatching();
        this.stop();
    }

    setElement (element) {
        this.element = element;
    }

    handleSettingsChange (settings) {
        if (settings.statsReadout === this.state.shown) return;
        this.setState({shown: settings.statsReadout});
        if (settings.statsReadout) this.start();
        else this.stop();
    }

    start () {
        const runtime = this.props.vm && this.props.vm.runtime;
        if (!runtime || this.timer) return;
        this.frames = 0;
        this.since = Date.now();
        runtime.on('BEFORE_EXECUTE', this.countFrame);
        this.timer = setInterval(this.sample, EVERY);
    }

    stop () {
        const runtime = this.props.vm && this.props.vm.runtime;
        if (runtime) runtime.removeListener('BEFORE_EXECUTE', this.countFrame);
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    sample () {
        const runtime = this.props.vm && this.props.vm.runtime;
        if (!runtime) return;
        const now = Date.now();
        const seconds = Math.max(0.001, (now - this.since) / 1000);
        const fps = this.frames / seconds;
        this.frames = 0;
        this.since = now;

        const targets = runtime.targets || [];
        this.setState({
            place: this.whereTheStageIs() || this.state.place,
            fps: Math.round(fps * 10) / 10,
            target: runtime.frameLoop ? runtime.frameLoop.framerate : 30,
            // Measured by the gameplay wrapper, which times the step anyway to
            // decide whether a drawing can be dropped.
            cost: Math.round(runtime.flipwarpFrameCost || 0),
            budget: Math.round(runtime.currentStepTime || 33),
            // Monitors run as threads too and would make the figure look
            // alarming while nothing of yours is running at all.
            threads: (runtime.threads || []).filter(t => !t.updateMonitor).length,
            clones: targets.filter(t => !t.isStage && !t.isOriginal).length,
            sprites: targets.filter(t => !t.isStage && t.isOriginal).length,
            skipped: (runtime.renderer && runtime.renderer.flipwarpSkippedFrames) || 0
        });
    }

    whereTheStageIs () {
        const canvas = this.props.vm && this.props.vm.runtime &&
            this.props.vm.runtime.renderer && this.props.vm.runtime.renderer.canvas;
        const parent = this.element && this.element.offsetParent;
        if (!canvas || !parent) return null;
        const stage = canvas.getBoundingClientRect();
        const box = parent.getBoundingClientRect();
        return {
            left: Math.round(stage.left - box.left) + 6,
            top: Math.round(stage.top - box.top) + 6
        };
    }

    render () {
        if (!this.state.shown) return null;
        const {fps, target, cost, budget, threads, clones, sprites, skipped} = this.state;
        // A frame that is taking longer than it has is the thing worth
        // noticing, so it is the only thing that changes colour.
        const overBudget = cost > budget;
        return (
            <div
                className={styles.readout}
                ref={this.setElement}
                style={{left: `${this.state.place.left}px`, top: `${this.state.place.top}px`}}
            >
                <div className={styles.line}>
                    <span className={styles.label}>{'fps'}</span>
                    <span className={styles.value}>{`${fps} / ${target === 0 ? 'screen' : target}`}</span>
                </div>
                <div className={styles.line}>
                    <span className={styles.label}>{'frame'}</span>
                    <span className={overBudget ? styles.over : styles.value}>
                        {`${cost} / ${budget} ms`}
                    </span>
                </div>
                <div className={styles.line}>
                    <span className={styles.label}>{'scripts'}</span>
                    <span className={styles.value}>{threads}</span>
                </div>
                <div className={styles.line}>
                    <span className={styles.label}>{'sprites'}</span>
                    <span className={styles.value}>{`${sprites} + ${clones}`}</span>
                </div>
                {skipped > 0 && (
                    <div className={styles.line}>
                        <span className={styles.label}>{'skipped'}</span>
                        <span className={styles.value}>{skipped}</span>
                    </div>
                )}
            </div>
        );
    }
}

StatsReadout.propTypes = {
    vm: PropTypes.shape({
        runtime: PropTypes.object
    })
};

export default StatsReadout;
