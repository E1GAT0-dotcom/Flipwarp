// Background radio, for working to.
//
// The stations come from Radio Browser, a public directory that is free to
// use and needs no key or account. Two things follow from it being public,
// and both shape this file:
//
//   Anyone can add a station, so a name and a genre tag are claims, not
//   facts. Nothing here treats anything the directory says as an
//   instruction — a station is a name to show and an address to play, and
//   that is all it ever becomes.
//
//   Stations die constantly. A directory entry is not a promise that
//   anything is on the other end, so a station that will not start is
//   stepped over rather than left as silence with a play button that looks
//   pressed.
//
// Flipwarp is served over https, so a station on plain http cannot be played
// at all — the browser blocks it. Those are filtered out rather than offered
// and then failing, which is most of why a genre has fewer stations here than
// the directory claims.

// Several mirrors run the same service. They go down individually, so the
// first one that answers wins. The proper way to find them is a DNS lookup a
// browser cannot make, so they are listed.
const MIRRORS = [
    'https://de1.api.radio-browser.info',
    'https://nl1.api.radio-browser.info',
    'https://at1.api.radio-browser.info'
];

// The genres offered, in the order they are shown. Tags are the directory's
// own, so these are the words it files stations under rather than words we
// invented — searching for a tag it does not use returns nothing.
export const GENRES = [
    {id: 'lofi', label: 'Lo-fi'},
    {id: 'jazz', label: 'Jazz'},
    {id: 'chillout', label: 'Chillout'},
    {id: 'ambient', label: 'Ambient'},
    {id: 'classical', label: 'Classical'},
    {id: 'electronic', label: 'Electronic'},
    {id: 'breakcore', label: 'Breakcore'},
    {id: 'jungle', label: 'Jungle'}
];

const HOW_MANY = 60;
const CACHE = new Map();

// A station, reduced to the two things that are used. Everything else the
// directory returns is dropped here rather than carried around, so nothing
// downstream can start depending on a field a stranger controls.
const cleanStation = raw => {
    const url = String(raw.url_resolved || raw.url || '');
    if (!url.startsWith('https://')) return null;
    const name = String(raw.name || '').replace(/\s+/g, ' ').trim();
    if (!name) return null;
    return {
        // Trimmed because some entries are padded out with decoration to sit
        // higher in a list, and a name that wide breaks the control it sits in.
        name: name.slice(0, 60),
        url,
        id: String(raw.stationuuid || url)
    };
};

const uniqueByName = stations => {
    const seen = new Set();
    return stations.filter(s => {
        const key = s.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

/**
 * The stations filed under one genre, most-voted first.
 *
 * Answers from memory once a genre has been asked for, so opening the picker
 * again is instant and the directory is not asked the same question twice in
 * one sitting.
 *
 * @param {string} tag the genre tag
 * @returns {Promise<Array>} the stations, possibly empty
 */
export const stationsFor = async tag => {
    if (CACHE.has(tag)) return CACHE.get(tag);

    let lastError = null;
    for (const mirror of MIRRORS) {
        try {
            const url = new URL(`${mirror}/json/stations/search`);
            url.searchParams.set('tag', tag);
            url.searchParams.set('limit', String(HOW_MANY));
            url.searchParams.set('hidebroken', 'true');
            url.searchParams.set('order', 'votes');
            url.searchParams.set('reverse', 'true');

            const res = await fetch(url, {headers: {Accept: 'application/json'}});
            if (!res.ok) throw new Error(`the station list came back as HTTP ${res.status}`);
            const raw = await res.json();
            if (!Array.isArray(raw)) throw new Error('the station list was not a list');

            const stations = uniqueByName(raw.map(cleanStation).filter(Boolean));
            CACHE.set(tag, stations);
            return stations;
        } catch (e) {
            lastError = e;
        }
    }
    throw new Error(
        lastError && /Failed to fetch|NetworkError/i.test(lastError.message) ?
            'Could not reach the station directory. It may be down, or the network may be blocking it.' :
            `Could not load the stations: ${lastError ? lastError.message : 'unknown reason'}`
    );
};

// How far the volume drops while a project is running, when the setting says
// to duck rather than mute. Quiet enough to hear a project's own sounds over,
// loud enough that it does not feel like it stopped.
const DUCK_TO = 0.25;

// How long a station gets to produce sound before it is treated as dead.
const START_TIMEOUT_MS = 9000;

/**
 * The player itself. One per page.
 *
 * Deliberately not a React component: the audio has to survive the control
 * being re-rendered, unmounted while the stage is small, and everything else
 * the editor does to its own layout. Music that stops because a menu opened
 * would be worse than no music.
 */
export class Radio {
    constructor () {
        this.audio = null;
        this.station = null;
        this.wanted = false;      // whether the person has asked for sound
        this.volume = 0.5;
        this.muted = false;       // the person pressed mute
        this.ducking = false;     // a project is running and the volume drops
        this.projectMuted = false; // a project is running and the setting says silence
        this.status = 'idle';     // idle | loading | playing | error
        this.message = '';
        this.listeners = new Set();
        this.startTimer = null;
    }

    on (fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    emit () {
        for (const fn of this.listeners) fn(this.state());
    }

    state () {
        return {
            station: this.station,
            playing: this.wanted && this.status === 'playing',
            status: this.status,
            message: this.message,
            volume: this.volume,
            muted: this.muted,
            ducking: this.ducking,
            projectMuted: this.projectMuted
        };
    }

    // The volume actually applied, once muting and ducking have had their say.
    // The person's own mute and the one a running project causes are kept
    // apart on purpose: stopping the project must not unmute something they
    // muted themselves.
    effectiveVolume () {
        if (this.muted || this.projectMuted) return 0;
        return this.ducking ? this.volume * DUCK_TO : this.volume;
    }

    applyVolume () {
        if (this.audio) this.audio.volume = this.effectiveVolume();
    }

    setVolume (v) {
        this.volume = Math.min(1, Math.max(0, v));
        this.applyVolume();
        this.emit();
    }

    setMuted (muted) {
        this.muted = !!muted;
        this.applyVolume();
        this.emit();
    }

    /**
     * Tell the radio whether a project is running.
     * @param {boolean} running whether the green flag is lit
     * @param {string} behaviour what to do about it: duck, mute, or nothing
     */
    setProjectRunning (running, behaviour) {
        const on = !!running && behaviour !== 'nothing';
        const duck = on && behaviour !== 'mute';
        const silence = on && behaviour === 'mute';
        if (this.ducking === duck && this.projectMuted === silence) return;
        this.ducking = duck;
        this.projectMuted = silence;
        this.applyVolume();
        this.emit();
    }

    setStatus (status, message = '') {
        this.status = status;
        this.message = message;
        this.emit();
    }

    clearStartTimer () {
        if (this.startTimer) {
            clearTimeout(this.startTimer);
            this.startTimer = null;
        }
    }

    teardown () {
        this.clearStartTimer();
        if (!this.audio) return;
        this.audio.onerror = null;
        this.audio.onplaying = null;
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
        this.audio = null;
    }

    /**
     * Play a station. Must be called from a click: a browser will not start
     * sound a person did not ask for, and refusing is the correct behaviour
     * rather than a fault to work around.
     *
     * @param {object} station the station to play
     * @returns {void}
     */
    play (station) {
        this.teardown();
        this.station = station;
        this.wanted = true;
        this.setStatus('loading');

        const audio = new Audio();
        audio.preload = 'auto';
        // No crossOrigin: the sound is only played, never read, and asking for
        // permission we do not need would rule out most stations.
        audio.src = station.url;
        audio.volume = this.effectiveVolume();
        this.audio = audio;

        audio.onplaying = () => {
            this.clearStartTimer();
            this.setStatus('playing');
        };
        audio.onerror = () => {
            this.clearStartTimer();
            this.setStatus('error', `${station.name} did not answer.`);
        };
        // A dead station often does not report an error at all — it accepts
        // the connection and then sends nothing, forever. So it gets a
        // deadline as well.
        this.startTimer = setTimeout(() => {
            if (this.status !== 'playing') {
                this.setStatus('error', `${station.name} did not start playing.`);
            }
        }, START_TIMEOUT_MS);

        audio.play().catch(e => {
            this.clearStartTimer();
            this.setStatus('error', e && e.name === 'NotAllowedError' ?
                'The browser would not start the sound. Press play again.' :
                `${station.name} would not play.`);
        });
    }

    pause () {
        this.wanted = false;
        this.teardown();
        this.setStatus('idle');
    }

    toggle (station) {
        if (this.wanted) this.pause();
        else if (station || this.station) this.play(station || this.station);
    }
}

let shared = null;

/**
 * The page's radio.
 * @returns {Radio} the one player
 */
export const getRadio = () => {
    if (!shared) shared = new Radio();
    return shared;
};
