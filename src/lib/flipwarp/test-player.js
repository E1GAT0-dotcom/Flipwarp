// A second player for testing a multiplayer game, in a tab of its own.
//
// A game made for rooms cannot be tested by one tab: what matters is what a
// friend sees when the host moves, and the other way round. So Claude can
// open a temporary test player. Its tab is an ordinary Flipwarp page that
// joins the room Claude's own tab is hosting, the way a friend's would, and
// gets the game the way a friend does, sent from the host. Claude then plays
// it as that second player.
//
// The two tabs are on the same local server, so they talk over a
// BroadcastChannel named with a random token. The test tab is given the token
// in its address and answers only on that channel, and only the requests that
// play a game (keys, the mouse, frames, a screenshot, its state). It cannot
// read or change the project, and it joins only the room in its address: the
// one Claude's tab is hosting, with the person's own game in it. It closes
// itself when the room ends, when Claude closes it, or when the host tab stops
// checking on it.

import rooms from './rooms.js';
import {PLAY_METHODS, installPlay} from './mcp-play.js';

const CHANNEL = 'flipwarp-test-player-';
const NAME = 'Claude test player';
// The host checks on the test tab this often, and the test tab gives up on
// a host it has not heard from for HOST_GONE.
const PING_EVERY = 5000;
const HOST_GONE = 30000;
// Joining goes through the public matchmaking server and a WebRTC handshake,
// which on a busy computer can miss the room's time limit: tried again.
const JOIN_TRIES = 3;
const PLAY = new Set(['greenFlag', 'stop', 'keys', 'releaseKeys', 'mouse', 'answer', 'freeze', 'stepFrames',
    'screenshot', 'state', 'logs']);

const tokenFromUrl = () => {
    try {
        const token = new URLSearchParams(location.search).get('fwtest') || '';
        return /^[a-z0-9]{16,64}$/.test(token) ? token : null;
    } catch (e) {
        return null;
    }
};

/** @returns {boolean} true in a test player's tab */
export const isTestPlayerTab = () => tokenFromUrl() !== null;

/** @returns {?string} the name a test player joins as, or null in any other tab */
export const testPlayerName = () => (isTestPlayerTab() ? NAME : null);

const randomToken = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

// --- the test player's own tab -------------------------------------------------

let triesLeft = 0;

const statusHere = vm => {
    const s = rooms.state;
    return {
        triesLeft,
        room: s.status,
        code: s.code,
        step: s.step,
        error: s.error || null,
        hostLeft: !!s.hostLeft,
        // Joined and holding the host's game, ready to play.
        ready: s.status === 'joined' && rooms.isFriendProject(),
        sprites: vm.runtime.targets.filter(t => t.isOriginal && !t.isStage).length
    };
};

const leave = () => {
    try {
        if (rooms.isActive()) rooms.leave(true);
    } catch (e) {
        // Closing anyway.
    }
    // A tab opened from the command line, with nothing in its history, can
    // close itself. If the browser will not let it, it says what it was.
    try {
        window.close();
    } catch (e) {
        // Shown below instead.
    }
    setTimeout(() => {
        document.title = 'Test player closed';
        document.body.innerHTML = '<p style="font: 16px sans-serif; margin: 2em">' +
            'This was Claude\'s test player. It is finished; you can close this tab.</p>';
    }, 500);
};

/**
 * In a test player's tab, answer the host tab on the channel in the address.
 * @param {object} vm the VM
 */
export const installTestPlayer = vm => {
    const token = tokenFromUrl();
    if (!token || typeof BroadcastChannel === 'undefined') return;
    installPlay(vm);
    const channel = new BroadcastChannel(CHANNEL + token);
    let heard = Date.now();
    let closing = false;
    const close = () => {
        if (closing) return;
        closing = true;
        channel.postMessage({from: 'player', event: 'closed'});
        channel.close();
        leave();
    };
    channel.onmessage = async ({data}) => {
        if (!data || data.from !== 'host' || closing) return;
        heard = Date.now();
        if (data.method === 'ping') return;
        const reply = out => channel.postMessage({from: 'player', id: data.id, ...out});
        if (data.method === 'close') {
            reply({result: {closed: true}});
            close();
            return;
        }
        try {
            if (data.method === 'status') {
                reply({result: statusHere(vm)});
                return;
            }
            if (!PLAY.has(data.method)) throw new Error(`The test player only plays: "${data.method}" is not for it.`);
            if (!statusHere(vm).ready) throw new Error('The test player has not got the game yet.');
            reply({result: await PLAY_METHODS[data.method](vm, data.params || {})});
        } catch (e) {
            reply({error: e && e.message ? e.message : String(e)});
        }
    };
    channel.postMessage({from: 'player', event: 'hello'});
    // Gone with the room, or with a host that stopped checking.
    let joined = false;
    let code = null;
    try {
        code = new URLSearchParams(location.search).get('room');
    } catch (e) {
        // Then there is nothing to try again.
    }
    triesLeft = code ? JOIN_TRIES - 1 : 0;
    let retrying = false;
    rooms.subscribe(state => {
        if (state.status === 'joined') joined = true;
        if (joined && (state.hostLeft || state.status === 'idle' || state.status === 'error')) {
            setTimeout(close, 1500);
            return;
        }
        if (!joined && state.error && triesLeft > 0 && !retrying && !closing) {
            retrying = true;
            setTimeout(() => {
                retrying = false;
                // Counted as it starts, so nobody reads "none left" while one is still to come.
                triesLeft--;
                if (!closing) rooms.join(code);
            }, 2000);
        }
    });
    setInterval(() => {
        if (Date.now() - heard > HOST_GONE) close();
    }, 5000);
};

// --- the host's side, in Claude's tab -------------------------------------------

let player = null;

const endPlayer = () => {
    if (!player) return;
    clearInterval(player.ping);
    for (const {reject, timer} of player.pending.values()) {
        clearTimeout(timer);
        reject(new Error('The test player closed.'));
    }
    try {
        player.channel.close();
    } catch (e) {
        // Already closed.
    }
    player = null;
};

const askPlayer = (method, params = {}, timeout = 30000) => new Promise((resolve, reject) => {
    if (!player) {
        reject(new Error('There is no test player open. Open one with test_player action "open".'));
        return;
    }
    const id = player.nextId++;
    const timer = setTimeout(() => {
        if (player) player.pending.delete(id);
        reject(new Error(`The test player did not answer "${method}" within ${timeout / 1000}s. Its tab may ` +
            'have been closed, or opened in a different browser from this one.'));
    }, timeout);
    player.pending.set(id, {resolve, reject, timer});
    player.channel.postMessage({from: 'host', id, method, params});
});

// The test player goes with the room it was in.
rooms.subscribe(state => {
    if (player && state.status !== 'hosting') endPlayer();
});

export const testPlayerMethods = {
    testPlayerOpen: () => {
        if (rooms.state.status !== 'hosting') {
            throw new Error('A test player joins the room this tab is hosting: open one first with room ' +
                'action "host".');
        }
        if (player) endPlayer();
        const token = randomToken();
        const channel = new BroadcastChannel(CHANNEL + token);
        player = {token, channel, pending: new Map(), nextId: 1, code: rooms.state.code};
        const mine = player;
        channel.onmessage = ({data}) => {
            if (!data || data.from !== 'player' || player !== mine) return;
            if (data.event === 'closed') {
                endPlayer();
                return;
            }
            const request = mine.pending.get(data.id);
            if (!request) return;
            mine.pending.delete(data.id);
            clearTimeout(request.timer);
            if (data.error) request.reject(new Error(data.error));
            else request.resolve(data.result);
        };
        player.ping = setInterval(() => channel.postMessage({from: 'host', method: 'ping'}), PING_EVERY);
        const url = new URL(`editor.html?room=${encodeURIComponent(rooms.state.code)}&fwtest=${token}`,
            location.href).href;
        return {url, code: rooms.state.code};
    },

    testPlayerAsk: (vm, {method, params, timeout}) => askPlayer(method, params, Math.min(timeout || 30000, 120000)),

    testPlayerClose: async () => {
        if (!player) return {closed: false, note: 'There was no test player open.'};
        try {
            await askPlayer('close', {}, 5000);
        } catch (e) {
            // It may have gone already.
        }
        endPlayer();
        return {closed: true};
    },

    testPlayerIsOpen: () => ({open: player !== null, code: player ? player.code : null})
};
