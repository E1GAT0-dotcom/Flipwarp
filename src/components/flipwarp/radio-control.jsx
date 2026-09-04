import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';

import {getRadio, stationsFor, GENRES} from '../../lib/flipwarp/radio.js';
import {getSettings, onSettingsChanged} from '../../lib/flipwarp/settings.js';
import styles from './radio-control.css';

/**
 * Play/pause for the background radio, sitting beside the green flag.
 *
 * The player itself lives outside React, so this component can come and go —
 * which it does, because the controls bar is rebuilt whenever the stage
 * changes size — without the music stopping.
 */
class RadioControl extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleToggle',
            'handlePicker',
            'handleGenre',
            'handleMute',
            'handleVolume',
            'handleRadioChange',
            'handleSettingsChange',
            'handleDocumentClick'
        ]);

        this.radio = getRadio();
        this.state = {
            ...this.radio.state(),
            open: false,
            genre: GENRES[0].id,
            stations: [],
            loading: false,
            listError: null,
            settings: getSettings()
        };
    }

    componentDidMount () {
        this.stopWatching = this.radio.on(this.handleRadioChange);
        this.stopWatchingSettings = onSettingsChanged(this.handleSettingsChange);
        document.addEventListener('mousedown', this.handleDocumentClick);
    }

    componentWillUnmount () {
        if (this.stopWatching) this.stopWatching();
        if (this.stopWatchingSettings) this.stopWatchingSettings();
        document.removeEventListener('mousedown', this.handleDocumentClick);
    }

    componentDidUpdate (prevProps) {
        // The stage tells us whether a project is running, and the setting
        // says what the radio should do about it.
        if (prevProps.running !== this.props.running) {
            this.radio.setProjectRunning(this.props.running, this.state.settings.musicWhileRunning);
        }
    }

    handleRadioChange (next) {
        this.setState(next);
    }

    handleSettingsChange (settings) {
        this.setState({settings, open: false});
        // Turning the radio off should stop the sound, not just hide the
        // button that was controlling it.
        if (!settings.musicPlayer) {
            this.radio.pause();
            return;
        }
        // Changing what happens during a project should take effect now
        // rather than at the next green flag.
        this.radio.setProjectRunning(this.props.running, settings.musicWhileRunning);
    }

    // Clicking anywhere else closes the picker, which is what every other
    // menu in the editor does.
    handleDocumentClick (e) {
        if (!this.state.open) return;
        if (this.root && this.root.contains(e.target)) return;
        this.setState({open: false});
    }

    handleToggle () {
        // Nothing chosen yet, so pressing play opens the list instead of
        // guessing — the first station of a genre is rarely the one wanted.
        if (!this.state.station) {
            this.handlePicker();
            return;
        }
        this.radio.toggle();
    }

    handlePicker () {
        const open = !this.state.open;
        this.setState({open});
        if (open && !this.state.stations.length) this.loadGenre(this.state.genre);
    }

    handleGenre (e) {
        const genre = e.target.value;
        this.setState({genre});
        this.loadGenre(genre);
    }

    handleMute () {
        this.radio.setMuted(!this.state.muted);
    }

    handleVolume (e) {
        this.radio.setVolume(Number(e.target.value) / 100);
    }

    loadGenre (genre) {
        this.setState({loading: true, listError: null, stations: []});
        stationsFor(genre)
            .then(stations => {
                // A slower answer for a genre nobody is looking at any more
                // must not replace the list on screen.
                if (this.state.genre !== genre) return;
                this.setState({stations, loading: false});
            })
            .catch(e => {
                if (this.state.genre !== genre) return;
                this.setState({loading: false, listError: e.message, stations: []});
            });
    }

    playStation (station) {
        this.setState({open: false});
        this.radio.play(station);
    }

    render () {
        const {station, playing, status, message, muted, volume, open, loading, listError, stations} = this.state;
        if (!this.state.settings.musicPlayer) return null;
        const busy = status === 'loading';
        const label = station ? station.name : 'Radio';

        return (
            <div
                className={styles.radio}
                ref={el => {
                    this.root = el;
                }}
            >
                <button
                    aria-label={playing ? 'Pause the radio' : 'Play the radio'}
                    aria-pressed={playing}
                    className={styles.play}
                    title={playing ? `Pause ${label}` : 'Play the radio'}
                    onClick={this.handleToggle}
                >
                    {busy ? <Spinner /> : playing ? <PauseMark /> : <PlayMark />}
                </button>

                <button
                    className={styles.name}
                    title="Choose a station"
                    onClick={this.handlePicker}
                >
                    {/* A station name is written by whoever added it to the
                        directory, so it is shown as plain text and nothing
                        else. */}
                    <span className={styles.nameText}>{label}</span>
                    <span
                        aria-hidden="true"
                        className={styles.caret}
                    >{'▾'}</span>
                </button>

                {status === 'error' && message ? (
                    <span
                        className={styles.problem}
                        title={message}
                    >{'!'}</span>
                ) : null}

                {open ? (
                    <div className={styles.picker}>
                        <div className={styles.pickerHead}>
                            <select
                                className={styles.genre}
                                value={this.state.genre}
                                onChange={this.handleGenre}
                            >
                                {GENRES.map(g => (
                                    <option
                                        key={g.id}
                                        value={g.id}
                                    >{g.label}</option>
                                ))}
                            </select>
                            <button
                                className={styles.mute}
                                title={muted ? 'Unmute' : 'Mute'}
                                onClick={this.handleMute}
                            >{muted ? 'Unmute' : 'Mute'}</button>
                            <input
                                aria-label="Volume"
                                className={styles.volume}
                                max="100"
                                min="0"
                                type="range"
                                value={Math.round(volume * 100)}
                                onChange={this.handleVolume}
                            />
                        </div>

                        <div className={styles.list}>
                            {loading ? <div className={styles.note}>{'Loading stations…'}</div> : null}
                            {listError ? <div className={styles.note}>{listError}</div> : null}
                            {!loading && !listError && !stations.length ? (
                                <div className={styles.note}>
                                    {'No stations for this one that will play over a secure connection.'}
                                </div>
                            ) : null}
                            {stations.map(s => (
                                <button
                                    className={`${styles.station} ${station && station.id === s.id ? styles.current : ''}`}
                                    key={s.id}
                                    onClick={() => this.playStation(s)}
                                >{s.name}</button>
                            ))}
                        </div>

                        <div className={styles.foot}>
                            {'Stations from the Radio Browser directory. Anyone can add one, so what a station plays is up to whoever runs it.'}
                        </div>
                    </div>
                ) : null}
            </div>
        );
    }
}

const PlayMark = () => (
    <svg
        aria-hidden="true"
        height="14"
        viewBox="0 0 16 16"
        width="14"
    >
        <path
            d="M4 2.5v11l9-5.5z"
            fill="currentColor"
        />
    </svg>
);

const PauseMark = () => (
    <svg
        aria-hidden="true"
        height="14"
        viewBox="0 0 16 16"
        width="14"
    >
        <path
            d="M4 2.5h3.2v11H4zM8.8 2.5H12v11H8.8z"
            fill="currentColor"
        />
    </svg>
);

const Spinner = () => (
    <svg
        aria-hidden="true"
        className={styles.spinner}
        height="14"
        viewBox="0 0 16 16"
        width="14"
    >
        <circle
            cx="8"
            cy="8"
            fill="none"
            r="6"
            stroke="currentColor"
            strokeDasharray="26 12"
            strokeWidth="2"
        />
    </svg>
);

RadioControl.propTypes = {
    running: PropTypes.bool
};

RadioControl.defaultProps = {
    running: false
};

export default RadioControl;
