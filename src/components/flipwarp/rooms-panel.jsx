import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import VM from 'scratch-vm';

import Box from '../box/box.jsx';
import Modal from '../../containers/modal.jsx';
import rooms, {normalizeCode} from '../../lib/flipwarp/rooms.js';
import {isClaudeTab} from '../../lib/flipwarp/rooms-ai.js';
import {getIsShowingProject} from '../../reducers/project-state';
import {setProjectTitle} from '../../reducers/project-title';
import {setFileHandle, setUsername} from '../../reducers/tw';
import styles from './rooms-panel.css';

const JOIN_STEPS = {
    finding: 'Looking for the room...',
    connecting: 'Connecting to the host...',
    downloading: 'Getting the project from the host...',
    loading: 'Loading the project...'
};

const roomFromUrl = () => {
    try {
        return new URLSearchParams(location.search).get('room') || '';
    } catch (e) {
        return '';
    }
};

/**
 * "Play with friends": host a room from this tab, or join someone else's.
 * The work is in lib/flipwarp/rooms.js; this is only what people see.
 */
class RoomsPanel extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleChange',
            'handleHost',
            'handleJoin',
            'handleLeave',
            'handleClose',
            'handleCopyLink',
            'handleCopyCode',
            'handleSendChat',
            'handleChatText',
            'handleChatKey',
            'handleCodeInput',
            'handleCodeKey',
            'handleNameInput',
            'handleNameBlur',
            'handleToggleFlag',
            'handleSendGame',
            'loadProject',
            'setChatRef'
        ]);
        this.state = {
            room: rooms.state,
            code: '',
            chatText: '',
            copied: '',
            name: props.username || ''
        };
        this.waiters = [];
    }
    componentDidMount () {
        rooms.attach(this.props.vm, {
            getName: () => this.state.name || this.props.username,
            getTitle: () => this.props.projectTitle,
            loader: this.loadProject
        });
        this.unsubscribe = rooms.subscribe(this.handleChange);
        const code = roomFromUrl();
        // A Claude tab never joins anything by itself.
        if (code && !rooms.isActive() && !isClaudeTab()) {
            // eslint-disable-next-line react/no-did-mount-set-state
            this.setState({code: normalizeCode(code)});
            rooms.join(code);
        }
    }
    componentDidUpdate (prevProps) {
        if (this.props.isShowingProject && this.waiters.length) {
            const waiters = this.waiters;
            this.waiters = [];
            waiters.forEach(fn => fn());
        }
        if (prevProps.username !== this.props.username && !this.state.name) {
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({name: this.props.username});
        }
        if (this.chatRef && this.state.room.chat.length !== this.lastChatLength) {
            this.lastChatLength = this.state.room.chat.length;
            this.chatRef.scrollTop = this.chatRef.scrollHeight;
        }
    }
    componentWillUnmount () {
        if (this.unsubscribe) this.unsubscribe();
        // A load waiting here would otherwise wait for good.
        const waiters = this.waiters;
        this.waiters = [];
        waiters.forEach(fn => fn());
        clearTimeout(this.copiedTimer);
    }
    handleChange (room) {
        this.setState({room});
    }
    // A joining guest's page may still be loading its own starting project.
    // The friend's project has to land after that, or it is replaced by it.
    whenProjectShowing () {
        if (this.props.isShowingProject) return Promise.resolve();
        return new Promise(resolve => this.waiters.push(resolve));
    }
    async loadProject (buffer, title) {
        await this.whenProjectShowing();
        const vm = this.props.vm;
        vm.quit();
        await vm.loadProject(buffer);
        // Saving now must not write the host's project over a file of yours.
        this.props.onClearFileHandle();
        if (title) this.props.onSetProjectTitle(title);
        if (vm.renderer) vm.renderer.draw();
    }
    handleClose () {
        rooms.closePanel();
    }
    handleHost () {
        this.commitName();
        rooms.host();
    }
    handleJoin () {
        if (this.state.code.length !== 5) return;
        // A tab Claude works in never holds somebody else's game: their room
        // opens on the public site, in a tab of its own that cannot reach
        // this one or the connection to Claude.
        if (isClaudeTab()) {
            window.open(rooms.publicLink(this.state.code), '_blank', 'noopener,noreferrer');
            this.setState({openedElsewhere: this.state.code});
            return;
        }
        if (this.props.projectChanged && !rooms.isFriendProject() &&
            // eslint-disable-next-line no-alert
            !window.confirm('Joining replaces the project open here with the host\'s. ' +
                'Changes you have not saved will be lost. Join anyway?')) return;
        this.commitName();
        rooms.join(this.state.code);
    }
    handleLeave () {
        rooms.leave(true);
    }
    handleCodeInput (e) {
        this.setState({code: normalizeCode(e.target.value)});
    }
    handleCodeKey (e) {
        if (e.key === 'Enter') this.handleJoin();
    }
    handleNameInput (e) {
        this.setState({name: e.target.value.slice(0, 24)});
    }
    handleNameBlur () {
        this.commitName();
    }
    commitName () {
        const name = this.state.name.trim();
        if (name && name !== this.props.username) this.props.onSetUsername(name);
    }
    async copy (text, what) {
        try {
            await navigator.clipboard.writeText(text);
            this.setState({copied: what});
            clearTimeout(this.copiedTimer);
            this.copiedTimer = setTimeout(() => this.setState({copied: ''}), 2000);
        } catch (e) {
            this.setState({copied: 'failed'});
        }
    }
    handleCopyLink () {
        this.copy(rooms.inviteLink(), 'link');
    }
    handleCopyCode () {
        this.copy(this.state.room.code, 'code');
    }
    handleSendChat () {
        rooms.sendChat(this.state.chatText);
        this.setState({chatText: ''});
    }
    handleChatText (e) {
        this.setState({chatText: e.target.value});
    }
    handleChatKey (e) {
        if (e.key === 'Enter') this.handleSendChat();
    }
    handleToggleFlag (e) {
        rooms.setFlagStartsEveryone(e.target.checked);
    }
    handleSendGame () {
        rooms.sendGameToEveryone();
    }
    setChatRef (el) {
        this.chatRef = el;
    }
    renderStart () {
        const {room} = this.state;
        const cloud = rooms.vm ? rooms.cloudCount() : 0;
        const starting = room.status === 'starting';
        return (
            <React.Fragment>
                <p className={styles.lead}>
                    {'Play this project with other people. Whoever hosts keeps this tab open, and it acts as '}
                    {'the cloud variable server: everyone who joins gets the project from them, and its cloud '}
                    {'variables are shared between everyone in the room.'}
                </p>

                <label className={styles.field}>
                    <span className={styles.label}>{'Your name'}</span>
                    <input
                        type="text"
                        className={styles.text}
                        value={this.state.name}
                        onChange={this.handleNameInput}
                        onBlur={this.handleNameBlur}
                        maxLength={24}
                    />
                </label>

                {room.error && <div className={styles.error}>{room.error}</div>}

                <div className={styles.columns}>
                    <div className={styles.column}>
                        <div className={styles.label}>{'Host'}</div>
                        <p className={styles.hint}>
                            {'Opens a room for this project and gives you a code to send to your friends.'}
                        </p>
                        <button
                            className={styles.go}
                            onClick={this.handleHost}
                            disabled={starting}
                        >
                            {starting ? 'Opening...' : 'Host a room'}
                        </button>
                    </div>
                    <div className={styles.column}>
                        <div className={styles.label}>{'Join'}</div>
                        <p className={styles.hint}>{'Type the code your friend sent you.'}</p>
                        <div className={styles.row}>
                            <input
                                type="text"
                                className={`${styles.text} ${styles.codeInput}`}
                                value={this.state.code}
                                onChange={this.handleCodeInput}
                                onKeyDown={this.handleCodeKey}
                                placeholder="ABCDE"
                                spellCheck={false}
                                autoComplete="off"
                            />
                            <button
                                className={styles.go}
                                onClick={this.handleJoin}
                                disabled={this.state.code.length !== 5 || starting}
                            >
                                {'Join'}
                            </button>
                        </div>
                    </div>
                </div>

                {this.state.openedElsewhere && (
                    <p className={styles.hint}>
                        {`Room ${this.state.openedElsewhere} opened in a new tab. Claude works in this tab, so `}
                        {'friends\' games always open in a separate one, where they cannot reach your Claude.'}
                    </p>
                )}

                {cloud === 0 && (
                    <p className={styles.hint}>
                        {'This project has no cloud variables, so a room can only be used for chatting. '}
                        {'To share something, make a variable for all sprites and tick "Store in the cloud".'}
                    </p>
                )}
            </React.Fragment>
        );
    }
    renderJoining () {
        const {room} = this.state;
        return (
            <React.Fragment>
                <p className={styles.lead}>
                    {`Joining room ${room.code}. `}
                    {JOIN_STEPS[room.step] || ''}
                    {room.step === 'downloading' && ` ${Math.round(room.progress * 100)}%`}
                </p>
                {room.step === 'downloading' && (
                    <div className={styles.bar}>
                        <div
                            className={styles.barFill}
                            style={{width: `${Math.round(room.progress * 100)}%`}}
                        />
                    </div>
                )}
                <div className={styles.buttons}>
                    <button
                        className={styles.quiet}
                        onClick={this.handleLeave}
                    >
                        {'Cancel'}
                    </button>
                </div>
            </React.Fragment>
        );
    }
    renderRoom () {
        const {room, copied} = this.state;
        const isHost = room.status === 'hosting';
        return (
            <React.Fragment>
                <div className={styles.field}>
                    <span className={styles.label}>{'Room code'}</span>
                    <div className={styles.row}>
                        <span className={styles.code}>{room.code}</span>
                        <button
                            className={styles.quiet}
                            onClick={this.handleCopyCode}
                        >
                            {copied === 'code' ? 'Copied' : 'Copy code'}
                        </button>
                        <button
                            className={styles.go}
                            onClick={this.handleCopyLink}
                        >
                            {copied === 'link' ? 'Copied' : 'Copy invite link'}
                        </button>
                    </div>
                    {copied === 'failed' && (
                        <p className={styles.hint}>
                            {`This browser would not let the page copy. The link is ${rooms.inviteLink()}`}
                        </p>
                    )}
                    {isHost && (
                        <p className={styles.hint}>
                            {'Keep this tab open while you play. If it closes, the room closes with it.'}
                        </p>
                    )}
                </div>

                <div className={styles.field}>
                    <span className={styles.label}>{`Players (${room.players.length}/8)`}</span>
                    <ul className={styles.players}>
                        {room.players.map(p => (
                            <li key={p.id}>
                                <span className={styles.playerName}>{p.name}</span>
                                {p.id === room.myId && <span className={styles.muted}>{'(you)'}</span>}
                                <span className={styles.muted}>
                                    {p.host ? 'host' : (p.loading ? 'loading...' : `${p.ping} ms`)}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>

                {isHost && (
                    <div className={styles.field}>
                        <label className={styles.choice}>
                            <input
                                type="checkbox"
                                checked={room.flagStartsEveryone}
                                onChange={this.handleToggleFlag}
                            />
                            {'Clicking the green flag starts the project for everyone'}
                        </label>
                        <div className={styles.buttons}>
                            <button
                                className={styles.quiet}
                                onClick={this.handleSendGame}
                                disabled={room.players.length < 2}
                            >
                                {'Send the project again'}
                            </button>
                            <span className={styles.hintInline}>{'For when you have changed it.'}</span>
                        </div>
                    </div>
                )}

                <div className={styles.field}>
                    <span className={styles.label}>{'Chat'}</span>
                    <div
                        className={styles.chat}
                        ref={this.setChatRef}
                    >
                        {room.chat.map((m, i) => (m.system ? (
                            <div
                                key={i}
                                className={styles.system}
                            >{m.text}</div>
                        ) : (
                            <div key={i}>
                                <b>{m.from}</b>
                                {`: ${m.text}`}
                            </div>
                        )))}
                    </div>
                    <div className={styles.row}>
                        <input
                            type="text"
                            className={styles.text}
                            value={this.state.chatText}
                            onChange={this.handleChatText}
                            onKeyDown={this.handleChatKey}
                            maxLength={300}
                        />
                        <button
                            className={styles.quiet}
                            onClick={this.handleSendChat}
                        >{'Send'}</button>
                    </div>
                </div>

                <div className={styles.buttons}>
                    <button
                        className={styles.leave}
                        onClick={this.handleLeave}
                    >
                        {isHost ? 'Close room' : 'Leave room'}
                    </button>
                </div>
            </React.Fragment>
        );
    }
    renderEnded () {
        return (
            <React.Fragment>
                <div className={styles.error}>{this.state.room.error}</div>
                <div className={styles.buttons}>
                    <button
                        className={styles.go}
                        onClick={this.handleLeave}
                    >
                        {'OK'}
                    </button>
                </div>
            </React.Fragment>
        );
    }
    render () {
        const {room} = this.state;
        if (!room.panelOpen) return null;
        let body;
        if (room.status === 'hosting' || room.status === 'joined') body = this.renderRoom();
        else if (room.status === 'joining') body = this.renderJoining();
        else if (room.status === 'ended') body = this.renderEnded();
        else body = this.renderStart();
        return (
            <Modal
                className={styles.modalContent}
                onRequestClose={this.handleClose}
                contentLabel="Play with friends"
                id="roomsModal"
            >
                <Box className={styles.body}>
                    {body}
                </Box>
            </Modal>
        );
    }
}

RoomsPanel.propTypes = {
    isShowingProject: PropTypes.bool,
    onClearFileHandle: PropTypes.func,
    onSetProjectTitle: PropTypes.func,
    onSetUsername: PropTypes.func,
    projectChanged: PropTypes.bool,
    projectTitle: PropTypes.string,
    username: PropTypes.string,
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => ({
    isShowingProject: getIsShowingProject(state.scratchGui.projectState.loadingState),
    projectChanged: state.scratchGui.projectChanged,
    projectTitle: state.scratchGui.projectTitle,
    username: state.scratchGui.tw.username
});

const mapDispatchToProps = dispatch => ({
    onClearFileHandle: () => dispatch(setFileHandle(null)),
    onSetProjectTitle: title => dispatch(setProjectTitle(title)),
    onSetUsername: username => dispatch(setUsername(username))
});

export default connect(mapStateToProps, mapDispatchToProps)(RoomsPanel);
