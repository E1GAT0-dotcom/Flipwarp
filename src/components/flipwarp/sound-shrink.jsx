import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import VM from 'scratch-vm';

import {shrink, estimateSize} from '../../lib/flipwarp/sound-shrink.js';
import styles from './sound-shrink.css';

const RATES = [
    {value: 0, label: 'Leave it alone'},
    {value: 32000, label: '32,000 a second'},
    {value: 22050, label: '22,050 a second'},
    {value: 16000, label: '16,000 a second'},
    {value: 11025, label: '11,025 a second'},
    {value: 8000, label: '8,000 a second — telephone'}
];

const size = bytes => (bytes >= 1024 * 1024 ?
    `${(bytes / 1024 / 1024).toFixed(2)} MB` :
    `${Math.round(bytes / 1024)} KB`);

/**
 * Making one sound smaller, with the result audible before it is kept.
 *
 * The listening is the point. Every choice here trades sound quality for room,
 * and how much quality you can stand to lose depends entirely on the sound —
 * a drum loop survives things a singing voice does not. Nothing here can tell
 * you that, so it plays you both instead.
 */
class SoundShrink extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleApply', 'handlePreview', 'handleOriginal', 'handleStop']);
        this.source = null;
        this.state = {
            sampleRate: 0,
            mono: props.channels > 1,
            format: 'wav',
            busy: false,
            playing: null,
            error: null,
            preview: null
        };
    }

    componentWillUnmount () {
        this.handleStop();
    }

    // What the choices would produce, worked out rather than made — so the
    // number moves as soon as a choice does, without any waiting.
    plan () {
        return {
            sampleRate: this.state.sampleRate || null,
            mono: this.state.mono || this.state.format === 'adpcm',
            format: this.state.format
        };
    }

    estimate () {
        const buffer = this.props.vm.getSoundBuffer(this.props.soundIndex);
        return estimateSize({
            sampleCount: buffer.length,
            sampleRate: buffer.sampleRate,
            channels: buffer.numberOfChannels,
            plan: this.plan()
        });
    }

    handleStop () {
        if (this.source) {
            try {
                this.source.stop();
            } catch (e) {
                // Already finished, which is not a problem.
            }
            this.source = null;
        }
        this.setState({playing: null});
    }

    playChannels (channels, sampleRate, which) {
        this.handleStop();
        const context = this.props.vm.runtime.audioEngine.audioContext;
        const buffer = context.createBuffer(channels.length, channels[0].length, sampleRate);
        channels.forEach((channel, i) => buffer.getChannelData(i).set(channel));
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => {
            if (this.source === source) this.setState({playing: null});
        };
        source.start();
        this.source = source;
        this.setState({playing: which});
    }

    handleOriginal () {
        if (this.state.playing === 'original') {
            this.handleStop();
            return;
        }
        const buffer = this.props.vm.getSoundBuffer(this.props.soundIndex);
        const channels = [];
        for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
        this.playChannels(channels, buffer.sampleRate, 'original');
    }

    async handlePreview () {
        if (this.state.playing === 'shrunk') {
            this.handleStop();
            return;
        }
        this.setState({busy: true, error: null});
        try {
            const buffer = this.props.vm.getSoundBuffer(this.props.soundIndex);
            const result = await shrink(buffer, this.plan());
            this.setState({busy: false, preview: result});
            this.playChannels(result.channels, result.sampleRate, 'shrunk');
        } catch (e) {
            this.setState({busy: false, error: describe(e)});
        }
    }

    async handleApply () {
        this.handleStop();
        this.setState({busy: true, error: null});
        try {
            const {vm, soundIndex} = this.props;
            const buffer = vm.getSoundBuffer(soundIndex);
            const result = await shrink(buffer, this.plan());

            const context = vm.runtime.audioEngine.audioContext;
            const played = context.createBuffer(
                result.channels.length, result.channels[0].length, result.sampleRate);
            result.channels.forEach((channel, i) => played.getChannelData(i).set(channel));

            vm.updateSoundBuffer(soundIndex, played, new Uint8Array(result.data));
            this.props.onDone(result.data.byteLength);
        } catch (e) {
            this.setState({busy: false, error: describe(e)});
        }
    }

    render () {
        const {before} = this.props;
        const after = this.estimate();
        const saved = before > 0 ? Math.round(((before - after) / before) * 100) : 0;
        const {busy, playing, error} = this.state;
        const forcedMono = this.state.format === 'adpcm';

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
                        <span className={styles.title}>{`Shrink "${this.props.name}"`}</span>
                        <button
                            className={styles.close}
                            onClick={this.props.onClose}
                        >{'✕'}</button>
                    </div>

                    <div className={styles.body}>
                        <div className={styles.sizes}>
                            <div className={styles.sizeBox}>
                                <span className={styles.sizeLabel}>{'Now'}</span>
                                <span className={styles.sizeValue}>{size(before)}</span>
                            </div>
                            <span className={styles.arrow}>{'→'}</span>
                            <div className={styles.sizeBox}>
                                <span className={styles.sizeLabel}>{'After'}</span>
                                <span className={`${styles.sizeValue} ${after < before ? styles.smaller : ''}`}>
                                    {size(after)}
                                </span>
                            </div>
                            {saved > 0 ? (
                                <span className={styles.saved}>{`${saved}% smaller`}</span>
                            ) : null}
                        </div>

                        <label className={styles.row}>
                            <span className={styles.rowLabel}>{'Stored as'}</span>
                            <select
                                className={styles.select}
                                value={this.state.format}
                                onChange={e => this.setState({format: e.target.value, preview: null})}
                            >
                                <option value="wav">{'Uncompressed — best quality'}</option>
                                <option value="adpcm">{'Compressed — about a quarter the size'}</option>
                            </select>
                        </label>

                        <label className={styles.row}>
                            <span className={styles.rowLabel}>{'Samples'}</span>
                            <select
                                className={styles.select}
                                value={this.state.sampleRate}
                                onChange={e => this.setState({
                                    sampleRate: Number(e.target.value), preview: null
                                })}
                            >
                                {RATES.map(r => (
                                    <option
                                        key={r.value}
                                        value={r.value}
                                    >{r.label}</option>
                                ))}
                            </select>
                        </label>

                        {this.props.channels > 1 ? (
                            <label className={styles.checkRow}>
                                <input
                                    checked={this.state.mono || forcedMono}
                                    disabled={forcedMono}
                                    type="checkbox"
                                    onChange={e => this.setState({mono: e.target.checked, preview: null})}
                                />
                                <span>
                                    {forcedMono ?
                                        'Mixed to one channel — the compressed form holds only one' :
                                        'Mix the two channels into one'}
                                </span>
                            </label>
                        ) : null}

                        <div className={styles.listen}>
                            <button
                                className={styles.listenButton}
                                onClick={this.handleOriginal}
                            >{playing === 'original' ? '■ Stop' : '▶ Hear it now'}</button>
                            <button
                                className={styles.listenButton}
                                disabled={busy}
                                onClick={this.handlePreview}
                            >{playing === 'shrunk' ? '■ Stop' : '▶ Hear it after'}</button>
                        </div>

                        {error ? <div className={styles.error}>{error}</div> : null}

                        <div className={styles.foot}>
                            <span className={styles.note}>
                                {this.state.format === 'adpcm' ?
                                    'A form Scratch has read since its earliest days, so it still plays there.' :
                                    'Listen to both before keeping it — how much you can lose depends on the sound.'}
                            </span>
                            <button
                                className={styles.apply}
                                disabled={busy}
                                onClick={this.handleApply}
                            >{busy ? 'Working…' : 'Keep it'}</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

const describe = e => (e && e.message ? e.message : String(e));

SoundShrink.propTypes = {
    before: PropTypes.number.isRequired,
    channels: PropTypes.number.isRequired,
    name: PropTypes.string,
    soundIndex: PropTypes.number.isRequired,
    vm: PropTypes.instanceOf(VM).isRequired,
    onClose: PropTypes.func.isRequired,
    onDone: PropTypes.func.isRequired
};

export default SoundShrink;
