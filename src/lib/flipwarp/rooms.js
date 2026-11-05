// Rooms: play a project with friends, with one of you as the server.
//
// Whoever presses "Host" turns their own browser tab into the cloud variable
// server. Nothing is rented, uploaded or deployed: the site is static files
// on GitHub Pages and the "server" is the host's tab, for as long as it stays
// open. Friends open an invite link (or type the room code), get the game
// sent straight from the host, and from then on every ☁ cloud variable the
// game sets goes to everyone in the room.
//
// How people find each other: two browsers cannot talk until they have
// swapped a few hundred bytes describing how to reach each other. PeerJS
// runs a free public matchmaking server for exactly that (0.peerjs.com), and
// it is spoken to directly here rather than through its library, which is
// written in syntax this build cannot read. It only carries those
// introductions: the game, the chat and the cloud variables then go browser
// to browser over WebRTC and never touch it. Its public relay (TURN) is listed
// too, for the friend whose network will not let a direct connection through.
//
// The shape of a room is a star. Every guest connects to the host only; the
// host owns the true value of every cloud variable (its own project's) and
// passes each change on to everyone else, the same job TurboWarp's cloud
// server does.

import log from '../log.js';

const SIGNAL_HOST = '0.peerjs.com';
const SIGNAL_KEY = 'peerjs';
const ID_PREFIX = 'flipwarp-room-';
const GUEST_PREFIX = 'flipwarp-guest-';

const ICE_SERVERS = [
    {urls: 'stun:stun.l.google.com:19302'},
    {urls: 'stun:stun.cloudflare.com:3478'},
    {
        urls: [
            'turn:eu-0.turn.peerjs.com:3478',
            'turn:us-0.turn.peerjs.com:3478'
        ],
        username: 'peerjs',
        credential: 'peerjsp'
    }
];

// No 0/O or 1/I/L: a code is read out loud or off a phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

const CHUNK_SIZE = 16 * 1024;
const MAX_BUFFERED = 1024 * 1024;
const MAX_PLAYERS = 8;
// Characters, kept well under WebRTC's 256 KB message limit even when every
// character takes three bytes.
const MAX_VALUE_LENGTH = 60000;
const MAX_CHAT = 300;
const MAX_NAME = 24;
const JOIN_TIMEOUT = 25000;
// A connection that has not said hello by then is closed, so nobody can fill
// a room's places with connections that never join.
const HELLO_TIMEOUT = 20000;
const MAX_PROJECT = 256 * 1024 * 1024;
// A download that gets no new piece for this long has stalled.
const STALL_TIMEOUT = 30000;
// Chat messages per guest, per CHAT_WINDOW milliseconds.
const CHAT_BURST = 6;
const CHAT_WINDOW = 4000;

const COLORS = ['#ff4d6d', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#22b8cf', '#f06595'];

// Where an invite link should point when the host is on a copy of Flipwarp
// running on their own computer: a friend cannot open localhost. Anywhere
// else (GitHub Pages, a fork's own Pages) the link is the page itself.
const PUBLIC_SITE = 'https://e1gat0-dotcom.github.io/Flipwarp/';

const randomId = n => {
    const bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
};

export const normalizeCode = text => String(text || '')
    .toUpperCase()
    .replace(/.*[?&]ROOM=/, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);

// Invisible characters (zero-width, direction marks) are taken out, so two
// names that look the same are the same.
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

const cleanName = name => String(name || '').replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME) || 'player';

const isScalar = value => typeof value === 'number' || typeof value === 'string';

// Once a room is over, reloading the page must not walk back into it.
const stripRoomFromAddress = () => {
    try {
        if (!/[?&]room=/i.test(location.search)) return;
        const url = new URL(location.href);
        url.searchParams.delete('room');
        history.replaceState(history.state, '', url.href);
    } catch (e) {
        // Not worth failing over.
    }
};

// What a cloud variable can hold on the wire. A boolean, or a number JSON
// cannot carry (NaN, Infinity), goes as the text Scratch would show for it,
// so every player ends up with the same value.
const wireValue = value => {
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'number' && !isFinite(value)) return String(value);
    return value;
};

/**
 * A connection to the matchmaking server, which passes the WebRTC handshake
 * between two browsers that do not know each other's address yet.
 */
class Signal {
    constructor (id, onMessage) {
        this.id = id;
        this.token = randomId(12).toLowerCase();
        this.onMessage = onMessage;
        this.onLost = () => {};
        this.ws = null;
        this.closed = false;
    }
    open () {
        return new Promise((resolve, reject) => {
            const url = `wss://${SIGNAL_HOST}/peerjs?key=${SIGNAL_KEY}` +
                `&id=${encodeURIComponent(this.id)}&token=${this.token}&version=1.5.4`;
            let settled = false;
            let ws;
            try {
                ws = new WebSocket(url);
            } catch (e) {
                reject(e);
                return;
            }
            this.ws = ws;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject(new Error('The matchmaking server did not answer.'));
                    ws.close();
                }
            }, 15000);
            ws.onmessage = event => {
                let msg;
                try {
                    msg = JSON.parse(event.data);
                } catch (e) {
                    return;
                }
                if (msg.type === 'OPEN') {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        resolve();
                    }
                } else if (msg.type === 'ID-TAKEN') {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        const err = new Error('taken');
                        err.taken = true;
                        reject(err);
                    }
                } else if (msg.type === 'ERROR') {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        reject(new Error((msg.payload && msg.payload.msg) || 'Matchmaking error'));
                    }
                } else if (msg.type !== 'HEARTBEAT') {
                    this.onMessage(msg);
                }
            };
            ws.onerror = () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    reject(new Error('Could not reach the matchmaking server.'));
                }
            };
            ws.onclose = () => {
                clearInterval(this.heartbeat);
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    reject(new Error('Could not reach the matchmaking server.'));
                } else if (!this.closed) {
                    this.onLost();
                }
            };
            clearInterval(this.heartbeat);
            this.heartbeat = setInterval(() => this.raw({type: 'HEARTBEAT'}), 5000);
        });
    }
    raw (msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }
    send (type, dst, payload) {
        this.raw({type, dst, payload});
    }
    close () {
        this.closed = true;
        clearInterval(this.heartbeat);
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
        }
        this.ws = null;
    }
}

/**
 * One WebRTC connection to one other browser, with a single ordered,
 * reliable data channel. Text messages are JSON; binary messages are pieces
 * of a project file.
 */
class Link {
    constructor ({peerId, cid, signal, onMessage, onBinary, onOpen, onClose}) {
        this.peerId = peerId;
        this.cid = cid;
        this.signal = signal;
        this.onMessage = onMessage;
        this.onBinary = onBinary;
        this.onOpen = onOpen;
        this.onClose = onClose;
        this.pendingCandidates = [];
        this.hasRemote = false;
        this.closed = false;
        this.pc = new RTCPeerConnection({iceServers: ICE_SERVERS});
        // Our address candidates wait until the offer or answer has gone:
        // the matchmaking server drops anything between two peers that does
        // not start with a proper offer.
        this.described = false;
        this.outbox = [];
        this.pc.onicecandidate = event => {
            if (!event.candidate) return;
            const payload = {
                candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
                type: 'data',
                connectionId: this.cid
            };
            if (this.described) this.signal.send('CANDIDATE', this.peerId, payload);
            else this.outbox.push(payload);
        };
        this.pc.onconnectionstatechange = () => {
            const state = this.pc.connectionState;
            if (state === 'failed' || state === 'closed') this.close();
        };
        this.pc.ondatachannel = event => this.useChannel(event.channel);
    }
    useChannel (dc) {
        this.dc = dc;
        dc.binaryType = 'arraybuffer';
        dc.bufferedAmountLowThreshold = 256 * 1024;
        dc.onopen = () => this.onOpen(this);
        dc.onclose = () => this.close();
        dc.onmessage = event => {
            if (typeof event.data === 'string') {
                let msg;
                try {
                    msg = JSON.parse(event.data);
                } catch (e) {
                    return;
                }
                if (msg && typeof msg.t === 'string') this.onMessage(this, msg);
            } else {
                this.onBinary(this, event.data);
            }
        };
    }
    async call () {
        this.useChannel(this.pc.createDataChannel('flipwarp', {ordered: true}));
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        // Shaped exactly like a PeerJS offer, which is what the matchmaking
        // server checks for before it passes anything on.
        this.signal.send('OFFER', this.peerId, {
            sdp: {type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp},
            type: 'data',
            connectionId: this.cid,
            label: this.cid,
            reliable: true,
            serialization: 'binary'
        });
        this.sendOutbox();
    }
    async answer (sdp) {
        await this.pc.setRemoteDescription(sdp);
        await this.flushCandidates();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.signal.send('ANSWER', this.peerId, {
            sdp: {type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp},
            type: 'data',
            connectionId: this.cid
        });
        this.sendOutbox();
    }
    sendOutbox () {
        this.described = true;
        const list = this.outbox;
        this.outbox = [];
        list.forEach(payload => this.signal.send('CANDIDATE', this.peerId, payload));
    }
    async accept (sdp) {
        await this.pc.setRemoteDescription(sdp);
        await this.flushCandidates();
    }
    async flushCandidates () {
        this.hasRemote = true;
        const list = this.pendingCandidates;
        this.pendingCandidates = [];
        for (const candidate of list) {
            try {
                await this.pc.addIceCandidate(candidate);
            } catch (e) {
                log.warn('rooms: bad candidate', e);
            }
        }
    }
    addCandidate (candidate) {
        if (!this.hasRemote) {
            this.pendingCandidates.push(candidate);
            return;
        }
        this.pc.addIceCandidate(candidate).catch(e => log.warn('rooms: bad candidate', e));
    }
    get isOpen () {
        return !!this.dc && this.dc.readyState === 'open';
    }
    send (msg) {
        if (!this.isOpen) return;
        const data = JSON.stringify(msg);
        const limit = (this.pc.sctp && this.pc.sctp.maxMessageSize) || 256 * 1024;
        if (data.length * 3 > limit) {
            log.warn('rooms: message too big to send', msg.t);
            return;
        }
        try {
            this.dc.send(data);
        } catch (e) {
            log.warn('rooms: send failed', e);
        }
    }
    async sendBytes (bytes, onProgress) {
        for (let i = 0; i < bytes.byteLength; i += CHUNK_SIZE) {
            if (!this.isOpen) throw new Error('closed');
            if (this.dc.bufferedAmount > MAX_BUFFERED) {
                await new Promise(resolve => {
                    const done = () => {
                        this.dc.removeEventListener('bufferedamountlow', done);
                        this.dc.removeEventListener('close', done);
                        resolve();
                    };
                    this.dc.addEventListener('bufferedamountlow', done);
                    this.dc.addEventListener('close', done);
                });
                if (!this.isOpen) throw new Error('closed');
            }
            this.dc.send(bytes.slice(i, Math.min(i + CHUNK_SIZE, bytes.byteLength)));
            if (onProgress) onProgress(Math.min(1, (i + CHUNK_SIZE) / bytes.byteLength));
        }
    }
    close () {
        if (this.closed) return;
        this.closed = true;
        try {
            if (this.dc) this.dc.close();
        } catch (e) { /* already gone */ }
        try {
            this.pc.close();
        } catch (e) { /* already gone */ }
        this.onClose(this);
    }
}

const freshState = () => ({
    // idle | starting | hosting | joining | joined | ended
    status: 'idle',
    code: '',
    error: '',
    // Shown while joining: finding | connecting | downloading | loading
    step: '',
    progress: 0,
    players: [],
    myId: '',
    chat: [],
    flagStartsEveryone: true,
    hostLeft: false,
    panelOpen: false
});

class Rooms {
    constructor () {
        this.vm = null;
        this.listeners = new Set();
        this.state = freshState();
        this.signal = null;
        this.links = new Map();
        this.hostLink = null;
        this.download = null;
        this.loader = null;
        this.gen = 0;
        this.playerCount = 0;
        this.getName = () => 'player';
        this.getTitle = () => '';
        this.provider = {
            createVariable: (name, value) => this.localSet(name, value),
            updateVariable: (name, value) => this.localSet(name, value),
            renameVariable: () => {},
            deleteVariable: () => {},
            requestCloseConnection: () => {}
        };
        // The room code a project was received from, while that project is
        // the one open: it belongs to whoever hosted it, not to this tab.
        this.friendProject = null;
        this.loadingFromRoom = false;
        this.handleProjectStart = this.handleProjectStart.bind(this);
        this.handleProjectLoaded = this.handleProjectLoaded.bind(this);
    }

    // Any project loaded some other way (a file, a project page, a new
    // project) is this tab's own again.
    handleProjectLoaded () {
        if (!this.loadingFromRoom) this.friendProject = null;
    }

    isFriendProject () {
        return this.friendProject !== null;
    }

    // --- wiring ------------------------------------------------------------

    attach (vm, {getName, getTitle, loader}) {
        if (this.vm !== vm) {
            if (this.vm) {
                this.vm.runtime.off('PROJECT_START', this.handleProjectStart);
                this.vm.runtime.off('PROJECT_LOADED', this.handleProjectLoaded);
            }
            this.vm = vm;
            vm.runtime.on('PROJECT_START', this.handleProjectStart);
            vm.runtime.on('PROJECT_LOADED', this.handleProjectLoaded);
        }
        if (getName) this.getName = getName;
        if (getTitle) this.getTitle = getTitle;
        if (loader) this.loader = loader;
    }

    subscribe (fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    set (patch) {
        this.state = Object.assign({}, this.state, patch);
        this.listeners.forEach(fn => fn(this.state));
    }

    isActive () {
        return ['starting', 'hosting', 'joining', 'joined'].includes(this.state.status);
    }

    get isHost () {
        return this.state.status === 'hosting';
    }

    openPanel () {
        this.set({panelOpen: true});
    }

    closePanel () {
        this.set({panelOpen: false});
    }

    inviteLink () {
        const here = location.hostname;
        const local = here === 'localhost' || here === '127.0.0.1' || here === '[::1]' || here.endsWith('.localhost');
        const base = local ? PUBLIC_SITE : new URL('./', location.href).href;
        return `${base}?room=${this.state.code}`;
    }

    // Keep the VM pointed at the room. TurboWarp's own cloud connection is
    // kept off while a room is open (see cloud-manager-hoc), but a project
    // load or a username change can clear the provider out from under us.
    useProvider () {
        if (!this.vm) return;
        if (this.vm.runtime.ioDevices.cloud.provider !== this.provider) {
            this.vm.setCloudProvider(this.provider);
        }
        clearInterval(this.providerTimer);
        this.providerTimer = setInterval(() => {
            if (this.isActive() && this.vm.runtime.ioDevices.cloud.provider !== this.provider) {
                this.vm.setCloudProvider(this.provider);
            }
        }, 1000);
    }

    releaseProvider () {
        clearInterval(this.providerTimer);
        if (this.vm && this.vm.runtime.ioDevices.cloud.provider === this.provider) {
            this.vm.setCloudProvider(null);
        }
    }

    cloudValues () {
        const stage = this.vm && this.vm.runtime.getTargetForStage();
        const vars = {};
        if (!stage) return vars;
        for (const variable of Object.values(stage.variables)) {
            const value = wireValue(variable.value);
            if (variable.isCloud && isScalar(value)) vars[variable.name] = value;
        }
        return vars;
    }

    cloudCount () {
        return Object.keys(this.cloudValues()).length;
    }

    applyRemote (name, value) {
        if (!this.vm || typeof name !== 'string' || !isScalar(value)) return false;
        if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) return false;
        const stage = this.vm.runtime.getTargetForStage();
        const variable = stage && Object.values(stage.variables).find(v => v.isCloud && v.name === name);
        if (!variable) return false;
        this.vm.postIOData('cloud', {varUpdate: {name, value}});
        return true;
    }

    // --- hosting -----------------------------------------------------------

    async host () {
        if (this.isActive()) return;
        this.reset();
        const gen = this.gen;
        this.set({status: 'starting', error: '', panelOpen: true});
        for (let attempt = 0; attempt < 4; attempt++) {
            const code = randomId(CODE_LENGTH);
            const signal = new Signal(ID_PREFIX + code, msg => this.hostSignal(msg));
            try {
                await signal.open();
            } catch (e) {
                if (gen !== this.gen) return;
                if (e.taken) continue;
                this.fail(`Could not start the room: ${e.message}`);
                return;
            }
            // Closed, or closed and opened again, while this one was starting.
            if (gen !== this.gen || this.state.status !== 'starting') {
                signal.close();
                return;
            }
            this.signal = signal;
            signal.onLost = () => this.reconnectSignal();
            const me = {id: 'host', name: cleanName(this.getName()), color: COLORS[0], host: true, ping: 0};
            this.set({status: 'hosting', code, myId: 'host', players: [me]});
            this.useProvider();
            this.system(`Room ${code} is open.`);
            this.pingTimer = setInterval(() => this.pingAll(), 2000);
            return;
        }
        if (gen === this.gen) this.fail('Could not find a free room code. Try again.');
    }

    // The matchmaking server drops quiet connections now and then. People
    // already in the room do not need it, but the next friend to join does.
    reconnectSignal () {
        if (!this.isHost || !this.signal) return;
        clearTimeout(this.signalRetry);
        this.signalRetry = setTimeout(() => {
            if (!this.isHost || !this.signal) return;
            this.signal.open().catch(() => this.reconnectSignal());
        }, 2000);
    }

    hostSignal (msg) {
        const payload = msg.payload || {};
        const src = msg.src;
        if (!src || !src.startsWith(GUEST_PREFIX)) return;
        if (msg.type === 'OFFER') {
            if (typeof payload.connectionId !== 'string' || !payload.sdp) return;
            if (this.links.has(payload.connectionId)) return;
            if (this.links.size >= MAX_PLAYERS - 1) return;
            const link = new Link({
                peerId: src,
                cid: payload.connectionId,
                signal: this.signal,
                onMessage: (l, m) => this.hostMessage(l, m),
                onBinary: () => {},
                onOpen: () => {},
                onClose: l => this.guestGone(l)
            });
            this.links.set(payload.connectionId, link);
            link.helloTimer = setTimeout(() => {
                if (!link.player) link.close();
            }, HELLO_TIMEOUT);
            link.answer(payload.sdp).catch(e => {
                log.warn('rooms: answer failed', e);
                link.close();
            });
        } else if (msg.type === 'CANDIDATE') {
            const link = this.links.get(payload.connectionId);
            if (link && link.peerId === src && payload.candidate) link.addCandidate(payload.candidate);
        }
    }

    uniqueName (wanted, except) {
        const taken = new Set(this.state.players.filter(p => p.id !== except).map(p => p.name.toLowerCase()));
        let name = cleanName(wanted);
        let n = 2;
        while (taken.has(name.toLowerCase())) {
            name = `${cleanName(wanted).slice(0, MAX_NAME - 3)} ${n++}`;
        }
        return name;
    }

    hostMessage (link, msg) {
        switch (msg.t) {
        case 'hello': {
            if (link.player) return;
            clearTimeout(link.helloTimer);
            const used = new Set(this.state.players.map(p => p.color));
            // Player ids are made here, never taken from the guest, so a guest
            // cannot pick one that is already somebody else's.
            const id = `p${++this.playerCount}`;
            const player = {
                id,
                name: this.uniqueName(msg.name, id),
                color: COLORS.find(c => !used.has(c)) || COLORS[this.state.players.length % COLORS.length],
                host: false,
                ping: 0,
                loading: true
            };
            link.player = player;
            this.set({players: this.state.players.concat(player)});
            link.send({t: 'welcome', you: player.id, code: this.state.code});
            this.broadcastPlayers();
            this.sendGameTo(link);
            break;
        }
        case 'ready': {
            if (!link.player || !link.player.loading || link.sending) return;
            // One variable per message: all of them at once could pass the
            // size a single message may have.
            const values = this.cloudValues();
            Object.keys(values).forEach(name => link.send({t: 'set', name, value: values[name]}));
            const first = !link.player.joined;
            this.updatePlayer(link.player.id, {loading: false, joined: true});
            if (first) this.system(`${link.player.name} joined`);
            break;
        }
        case 'set': {
            if (!link.player || link.player.loading) return;
            if (this.applyRemote(msg.name, msg.value)) {
                const out = {t: 'set', name: msg.name, value: msg.value};
                this.links.forEach(other => {
                    if (other !== link && other.player && !other.player.loading) other.send(out);
                });
            }
            break;
        }
        case 'chat': {
            if (!link.player || typeof msg.text !== 'string') return;
            const now = Date.now();
            link.chatTimes = (link.chatTimes || []).filter(t => now - t < CHAT_WINDOW);
            if (link.chatTimes.length >= CHAT_BURST) return;
            link.chatTimes.push(now);
            this.addChat(link.player.id, msg.text);
            break;
        }
        case 'ping':
            link.send({t: 'pong', ts: msg.ts});
            break;
        case 'pong':
            if (typeof msg.ts === 'number' && link.player) {
                this.updatePlayer(link.player.id, {ping: Math.max(0, Math.round(performance.now() - msg.ts))}, true);
            }
            break;
        }
    }

    // One project at a time down each connection: two sends at once would
    // interleave their pieces and the guest would get neither.
    sendGameTo (link) {
        link.sendChain = (link.sendChain || Promise.resolve()).then(() => this.sendGameNow(link));
        return link.sendChain;
    }

    async sendGameNow (link) {
        if (!this.vm || link.closed) return;
        link.sending = true;
        try {
            const blob = await this.vm.saveProjectSb3();
            const bytes = await blob.arrayBuffer();
            link.send({t: 'project', size: bytes.byteLength, title: this.getTitle() || ''});
            await link.sendBytes(bytes);
        } catch (e) {
            if (e.message !== 'closed') log.warn('rooms: could not send project', e);
        } finally {
            // Sends to one link are chained, so nothing else touches this meanwhile.
            link.sending = false; // eslint-disable-line require-atomic-updates
        }
    }

    async sendGameToEveryone () {
        if (!this.isHost) return;
        this.state.players.forEach(p => {
            if (!p.host) this.updatePlayer(p.id, {loading: true}, true);
        });
        this.broadcastPlayers();
        this.system('Sending the project to everyone again.');
        await Promise.all(Array.from(this.links.values()).filter(l => l.player)
            .map(l => this.sendGameTo(l)));
    }

    guestGone (link) {
        clearTimeout(link.helloTimer);
        if (this.links.get(link.cid) === link) this.links.delete(link.cid);
        if (!link.player) return;
        this.set({players: this.state.players.filter(p => p.id !== link.player.id)});
        this.broadcastPlayers();
        this.system(`${link.player.name} left`);
    }

    updatePlayer (id, patch, quiet) {
        this.set({players: this.state.players.map(p => (p.id === id ? Object.assign({}, p, patch) : p))});
        // The link keeps its own copy of the player, and that copy is what
        // decides whether a guest is ready for cloud changes. Both change.
        this.links.forEach(link => {
            if (link.player && link.player.id === id) Object.assign(link.player, patch);
        });
        if (this.isHost && !quiet) this.broadcastPlayers();
    }

    broadcastPlayers () {
        if (!this.isHost) return;
        const list = this.state.players.map(p => ({
            id: p.id, name: p.name, color: p.color, host: p.host, ping: p.ping, loading: !!p.loading
        }));
        this.links.forEach(l => l.player && l.send({t: 'players', list}));
    }

    // Pings are measured one guest at a time but told to everyone together,
    // once a round, rather than a list going out for every answer.
    pingAll () {
        const ts = performance.now();
        this.links.forEach(l => l.send({t: 'ping', ts}));
        this.broadcastPlayers();
    }

    // --- joining -----------------------------------------------------------

    async join (rawCode) {
        const code = normalizeCode(rawCode);
        if (code.length !== CODE_LENGTH) {
            this.set({error: `A room code is ${CODE_LENGTH} letters and numbers.`, panelOpen: true});
            return;
        }
        if (this.isActive()) this.leave(true);
        this.reset();
        const gen = this.gen;
        this.set({status: 'joining', code, step: 'finding', progress: 0, error: '', panelOpen: true});
        const signal = new Signal(GUEST_PREFIX + randomId(10).toLowerCase(), msg => this.guestSignal(msg));
        this.signal = signal;
        try {
            await signal.open();
        } catch (e) {
            if (gen === this.gen) this.fail(`Could not reach the matchmaking server: ${e.message}`);
            return;
        }
        if (gen !== this.gen) return;
        this.set({step: 'connecting'});
        const link = new Link({
            peerId: ID_PREFIX + code,
            cid: `dc_${randomId(10).toLowerCase()}`,
            signal,
            onMessage: (l, m) => this.guestMessage(l, m),
            onBinary: (l, data) => this.guestBytes(data),
            onOpen: l => {
                l.send({t: 'hello', name: cleanName(this.getName())});
                // Connected: the matchmaking server has nothing left to do.
                if (this.signal === signal) {
                    signal.close();
                    this.signal = null;
                }
            },
            onClose: () => this.hostGone()
        });
        this.hostLink = link;
        this.joinTimer = setTimeout(() => {
            const step = this.state.step;
            if (gen === this.gen && this.state.status === 'joining' && step !== 'downloading' && step !== 'loading') {
                this.fail(`Could not connect to room ${code}. ` +
                    'Check the code, and that your friend still has the room open.');
            }
        }, JOIN_TIMEOUT);
        link.call().catch(e => {
            if (gen === this.gen) this.fail(`Could not connect: ${e.message}`);
        });
    }

    guestSignal (msg) {
        const payload = msg.payload || {};
        const link = this.hostLink;
        // EXPIRE: the room's code is not connected to the matchmaking server.
        // It only means anything before the two browsers have reached each other.
        const reached = link && link.isOpen;
        if ((msg.type === 'EXPIRE' || msg.type === 'ERROR') && this.state.status === 'joining' && !reached) {
            this.fail(`There is no room called ${this.state.code} right now. ` +
                'Check the code, or ask your friend to host again.');
            return;
        }
        if (!link || payload.connectionId !== link.cid) return;
        if (msg.type === 'ANSWER') {
            link.accept(payload.sdp).catch(e => this.fail(`Could not connect: ${e.message}`));
        } else if (msg.type === 'CANDIDATE' && payload.candidate) {
            link.addCandidate(payload.candidate);
        }
    }

    guestMessage (link, msg) {
        switch (msg.t) {
        case 'welcome':
            if (typeof msg.you === 'string') this.set({myId: msg.you});
            break;
        case 'players':
            if (Array.isArray(msg.list)) {
                const list = msg.list.slice(0, MAX_PLAYERS)
                    .filter(p => p && typeof p.id === 'string' && typeof p.name === 'string')
                    .map(p => ({
                        id: p.id.slice(0, 40),
                        name: cleanName(p.name),
                        host: p.host === true,
                        loading: p.loading === true,
                        ping: typeof p.ping === 'number' && isFinite(p.ping) ? Math.round(p.ping) : 0
                    }));
                this.set({players: list});
            }
            break;
        case 'project':
            if (!Number.isInteger(msg.size) || msg.size <= 0 || msg.size > MAX_PROJECT) return;
            this.download = {
                size: msg.size,
                title: typeof msg.title === 'string' ? msg.title.slice(0, 100) : '',
                bytes: new Uint8Array(msg.size),
                got: 0
            };
            this.watchDownload();
            if (this.state.status === 'joining') this.set({step: 'downloading', progress: 0});
            else this.system('The host is sending a new version of the project.');
            break;
        case 'state':
            if (msg.vars && typeof msg.vars === 'object') {
                Object.keys(msg.vars).slice(0, 1000)
                    .forEach(name => this.applyRemote(name, msg.vars[name]));
            }
            break;
        case 'set':
            this.applyRemote(msg.name, msg.value);
            break;
        case 'chat':
            if (typeof msg.text === 'string' && typeof msg.from === 'string') {
                this.pushChat({from: msg.from, text: msg.text.slice(0, MAX_CHAT)});
            }
            break;
        case 'flag':
            if (this.vm) {
                this.remoteFlag = true;
                this.vm.greenFlag();
                this.remoteFlag = false;
            }
            break;
        case 'ping':
            link.send({t: 'pong', ts: msg.ts});
            break;
        case 'bye':
            this.set({hostLeft: true});
            link.close();
            break;
        }
    }

    guestBytes (data) {
        const dl = this.download;
        if (!dl) return;
        const chunk = new Uint8Array(data);
        if (dl.got + chunk.byteLength > dl.size) {
            this.download = null;
            return;
        }
        dl.bytes.set(chunk, dl.got);
        dl.got += chunk.byteLength;
        this.watchDownload();
        if (this.state.status === 'joining') this.set({progress: dl.got / dl.size});
        if (dl.got === dl.size) {
            clearTimeout(this.stallTimer);
            this.download = null;
            const gen = this.gen;
            this.loadChain = (this.loadChain || Promise.resolve())
                .then(() => (gen === this.gen ? this.loadReceived(dl.bytes.buffer, dl.title) : null));
        }
    }

    watchDownload () {
        clearTimeout(this.stallTimer);
        const gen = this.gen;
        this.stallTimer = setTimeout(() => {
            if (gen === this.gen && this.download) {
                this.fail('The project stopped arriving part way. Try joining again.');
            }
        }, STALL_TIMEOUT);
    }

    async loadReceived (buffer, title) {
        const gen = this.gen;
        const first = this.state.status === 'joining';
        if (first) this.set({step: 'loading', progress: 1});
        // Marked before it loads, so whatever the project asks for while
        // loading (custom extensions) is already known to be someone else's.
        this.friendProject = this.state.code;
        this.loadingFromRoom = true;
        try {
            if (this.loader) {
                await this.loader(buffer, title);
            } else {
                this.vm.quit();
                await this.vm.loadProject(buffer);
            }
        } catch (e) {
            if (this.hostLink) this.fail(`The project would not load: ${e.message || e}`);
            return;
        } finally {
            this.loadingFromRoom = false;
        }
        // Left, or joined somewhere else, while it loaded.
        if (gen !== this.gen || !this.hostLink || this.hostLink.closed) return;
        this.useProvider();
        this.hostLink.send({t: 'ready'});
        clearTimeout(this.joinTimer);
        if (first) {
            this.set({status: 'joined', step: '', panelOpen: false});
            this.system(`Joined room ${this.state.code}.`);
        } else {
            this.system('Loaded the new version.');
        }
    }

    hostGone () {
        if (this.state.status === 'joined' || (this.state.status === 'joining' && this.state.step !== 'connecting')) {
            this.cleanup();
            this.set({
                status: 'ended',
                error: this.state.hostLeft ? 'The host closed the room.' : 'Lost the connection to the host.',
                players: [],
                panelOpen: true
            });
            stripRoomFromAddress();
        } else if (this.state.status === 'joining') {
            this.fail('Could not connect to the host. Their network or yours may be blocking it: ' +
                'try another network, or swap who hosts.');
        }
    }

    // --- both --------------------------------------------------------------

    localSet (name, value) {
        value = wireValue(value);
        if (!isScalar(value)) return;
        if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) {
            log.warn(`rooms: ${name} is too long to share (${value.length} characters)`);
            return;
        }
        const msg = {t: 'set', name, value};
        if (this.isHost) {
            this.links.forEach(l => l.player && !l.player.loading && l.send(msg));
        } else if (this.state.status === 'joined' && this.hostLink) {
            this.hostLink.send(msg);
        }
    }

    handleProjectStart () {
        if (!this.isHost || !this.state.flagStartsEveryone || this.remoteFlag) return;
        this.links.forEach(l => l.player && !l.player.loading && l.send({t: 'flag'}));
    }

    setFlagStartsEveryone (value) {
        this.set({flagStartsEveryone: !!value});
    }

    sendChat (text) {
        text = String(text || '').trim()
            .slice(0, MAX_CHAT);
        if (!text) return;
        if (this.isHost) {
            this.addChat('host', text);
        } else if (this.state.status === 'joined' && this.hostLink) {
            this.hostLink.send({t: 'chat', text});
        }
    }

    // Host only: chat goes out with the sender's name filled in by the host,
    // so nobody can speak as somebody else.
    addChat (fromId, text) {
        const player = this.state.players.find(p => p.id === fromId);
        if (!player) return;
        const entry = {from: player.name, color: player.color, text: text.slice(0, MAX_CHAT)};
        this.pushChat(entry);
        this.links.forEach(l => l.player && l.send({t: 'chat', from: entry.from, text: entry.text}));
    }

    pushChat (entry) {
        if (!entry.color) {
            const player = this.state.players.find(p => p.name === entry.from);
            entry.color = player ? player.color : '#888';
        }
        this.set({chat: this.state.chat.concat(entry).slice(-60)});
    }

    system (text) {
        this.set({chat: this.state.chat.concat({system: true, text}).slice(-60)});
    }

    fail (error) {
        this.cleanup();
        this.set({status: 'idle', error, step: '', players: [], panelOpen: true});
        stripRoomFromAddress();
    }

    leave (quiet) {
        // Closing a connection throws away what it has not sent yet, so the
        // goodbye gets a moment to go before the connections are closed.
        let lingering = [];
        if (this.isHost) {
            lingering = Array.from(this.links.values());
            this.links.clear();
            lingering.forEach(l => {
                clearTimeout(l.helloTimer);
                l.onClose = () => {};
                l.send({t: 'bye'});
            });
        }
        this.cleanup();
        setTimeout(() => lingering.forEach(l => l.close()), 500);
        this.set(Object.assign(freshState(), {
            panelOpen: quiet ? this.state.panelOpen : false,
            flagStartsEveryone: this.state.flagStartsEveryone
        }));
        stripRoomFromAddress();
    }

    reset () {
        this.cleanup();
        this.set(Object.assign(freshState(), {
            panelOpen: this.state.panelOpen,
            flagStartsEveryone: this.state.flagStartsEveryone
        }));
    }

    // Everything that waits on the network checks the generation it started
    // in, so a room that was closed cannot come back to life when a late
    // answer for it arrives.
    cleanup () {
        this.gen++;
        clearInterval(this.pingTimer);
        clearTimeout(this.joinTimer);
        clearTimeout(this.signalRetry);
        const links = Array.from(this.links.values());
        this.links.clear();
        links.forEach(l => {
            clearTimeout(l.helloTimer);
            l.onClose = () => {};
            l.close();
        });
        if (this.hostLink) {
            this.hostLink.onClose = () => {};
            this.hostLink.close();
            this.hostLink = null;
        }
        if (this.signal) this.signal.close();
        this.signal = null;
        this.download = null;
        this.releaseProvider();
    }
}

const rooms = new Rooms();

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
        if (rooms.isHost) rooms.links.forEach(l => l.send({t: 'bye'}));
    });
}

export default rooms;
