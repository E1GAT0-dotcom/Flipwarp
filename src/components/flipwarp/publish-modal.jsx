import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import {FormattedMessage, defineMessages, injectIntl, intlShape} from 'react-intl';

import Box from '../box/box.jsx';
import Modal from '../../containers/modal.jsx';
import {
    NEW_PROJECT, bookmarklet, editorFor, idFrom, projectFile, rememberId,
    rememberedId, ticketFor
} from '../../lib/flipwarp/publish-to-scratch.js';
import styles from './publish-modal.css';

const messages = defineMessages({
    title: {
        defaultMessage: 'Publish to Scratch',
        description: 'Title of the publish dialog',
        id: 'flipwarp.publish.title'
    }
});

/**
 * Getting a project onto Scratch, in as few presses as the web allows.
 *
 * Three, and the middle one cannot be helped. Flipwarp saves the file and puts
 * the words on the clipboard; you load the file in Scratch's own editor and
 * press Save, which is the part nobody outside Scratch is allowed to automate;
 * then the bookmarklet sets the title and the notes and shares it if you asked.
 */
class PublishModal extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleTitle',
            'handleInstructions',
            'handleShare',
            'handleTarget',
            'handleId',
            'handleGetReady',
            'handleOpenScratch',
            'handleCopyTicket',
            'handleCopyBookmarklet'
        ]);
        const title = props.projectTitle || 'My project';
        const known = rememberedId(title);
        this.state = {
            title,
            instructions: '',
            share: false,
            // Which project this is going to be. Remembering the last one is
            // what makes "the same project again" possible without asking you
            // to keep a number somewhere.
            target: known ? 'same' : 'new',
            id: known,
            busy: false,
            error: null,
            file: null,
            copied: null
        };
    }

    componentWillUnmount () {
        this.unmounted = true;
        if (this.state.file) URL.revokeObjectURL(this.state.file.url);
    }

    handleTitle (e) {
        this.setState({title: e.target.value});
    }

    handleInstructions (e) {
        this.setState({instructions: e.target.value});
    }

    handleShare (e) {
        this.setState({share: e.target.checked});
    }

    handleTarget (e) {
        this.setState({target: e.target.value});
    }

    handleId (e) {
        this.setState({id: e.target.value});
    }

    // Copying is offered rather than done: a page that reaches for the
    // clipboard on its own is a page that has taken something.
    async copy (text, what) {
        try {
            await navigator.clipboard.writeText(text);
            this.setState({copied: what});
        } catch (e) {
            this.setState({error: 'This browser would not let the page write to the clipboard. ' +
                'Select the text and copy it yourself.'});
        }
    }

    handleCopyTicket () {
        this.copy(ticketFor(this.state), 'ticket');
    }

    handleCopyBookmarklet () {
        this.copy(bookmarklet(), 'bookmarklet');
    }

    async handleGetReady () {
        if (this.state.busy) return;
        this.setState({busy: true, error: null});
        try {
            const file = await projectFile(this.props.vm, this.state.title);
            if (this.unmounted) {
                URL.revokeObjectURL(file.url);
                return;
            }
            if (this.state.file) URL.revokeObjectURL(this.state.file.url);
            rememberId(this.props.projectTitle || this.state.title,
                this.state.target === 'same' ? idFrom(this.state.id) : '');
            this.setState({busy: false, file});
            await this.copy(ticketFor(this.state), 'ticket');
        } catch (e) {
            if (this.unmounted) return;
            this.setState({busy: false, error: e && e.message ? e.message : String(e)});
        }
    }

    handleOpenScratch () {
        const where = this.state.target === 'same' && idFrom(this.state.id) ?
            editorFor(this.state.id) : NEW_PROJECT;
        window.open(where, '_blank', 'noopener,noreferrer');
    }

    render () {
        const {intl} = this.props;
        const {busy, error, file, copied} = this.state;
        const sameProject = this.state.target === 'same';
        return (
            <Modal
                className={styles.modalContent}
                onRequestClose={this.props.onClose}
                contentLabel={intl.formatMessage(messages.title)}
                id="publishModal"
            >
                <Box className={styles.body}>
                    <p className={styles.lead}>
                        <FormattedMessage
                            // eslint-disable-next-line max-len
                            defaultMessage="Scratch will not let another website post to your account, which is the rule that stops any page you visit doing it while you are signed in. So this does the parts it can and hands you the one part it cannot: loading the file."
                            description="Explanation at the top of the publish dialog"
                            id="flipwarp.publish.lead"
                        />
                    </p>

                    <label className={styles.field}>
                        <span className={styles.label}>
                            <FormattedMessage
                                defaultMessage="Title"
                                description="Label for the project title"
                                id="flipwarp.publish.projectTitle"
                            />
                        </span>
                        <input
                            type="text"
                            className={styles.text}
                            value={this.state.title}
                            onChange={this.handleTitle}
                        />
                    </label>

                    <label className={styles.field}>
                        <span className={styles.label}>
                            <FormattedMessage
                                defaultMessage="Instructions and notes"
                                description="Label for the project description"
                                id="flipwarp.publish.instructions"
                            />
                        </span>
                        <textarea
                            className={styles.area}
                            rows={4}
                            value={this.state.instructions}
                            onChange={this.handleInstructions}
                        />
                    </label>

                    <div className={styles.field}>
                        <label className={styles.choice}>
                            <input
                                type="radio"
                                name="flipwarp-publish-target"
                                value="new"
                                checked={!sameProject}
                                onChange={this.handleTarget}
                            />
                            <FormattedMessage
                                defaultMessage="A new project on Scratch"
                                description="Publish to a new project"
                                id="flipwarp.publish.new"
                            />
                        </label>
                        <label className={styles.choice}>
                            <input
                                type="radio"
                                name="flipwarp-publish-target"
                                value="same"
                                checked={sameProject}
                                onChange={this.handleTarget}
                            />
                            <FormattedMessage
                                defaultMessage="Over the top of one I already have"
                                description="Publish over an existing project"
                                id="flipwarp.publish.same"
                            />
                        </label>
                        {sameProject && (
                            <label className={styles.inline}>
                                <FormattedMessage
                                    defaultMessage="Its number or address"
                                    description="Label for the Scratch project id"
                                    id="flipwarp.publish.id"
                                />
                                <input
                                    type="text"
                                    className={styles.text}
                                    value={this.state.id}
                                    onChange={this.handleId}
                                    placeholder="1234567890"
                                />
                            </label>
                        )}
                    </div>

                    <div className={styles.field}>
                        <label className={styles.choice}>
                            <input
                                type="checkbox"
                                checked={this.state.share}
                                onChange={this.handleShare}
                            />
                            <FormattedMessage
                                defaultMessage="Share it publicly as well"
                                description="Label for the share option"
                                id="flipwarp.publish.share"
                            />
                        </label>
                        <p className={styles.hint}>
                            <FormattedMessage
                                // eslint-disable-next-line max-len
                                defaultMessage="Off, the project sits in your account for you to look at and you press Share yourself. On, the bookmarklet shares it in the same breath as setting the title."
                                description="Help for the share option"
                                id="flipwarp.publish.shareHint"
                            />
                        </p>
                    </div>

                    {error && <div className={styles.error}>{error}</div>}

                    <ol className={styles.steps}>
                        <li>
                            <button
                                className={styles.go}
                                onClick={this.handleGetReady}
                                disabled={busy}
                            >
                                <FormattedMessage
                                    defaultMessage="Get it ready"
                                    description="Button that saves the file and copies the ticket"
                                    id="flipwarp.publish.getReady"
                                />
                            </button>
                            {file ? (
                                <span className={styles.done}>
                                    <a
                                        href={file.url}
                                        download={file.name}
                                    >{file.name}</a>
                                    {copied === 'ticket' ? ' saved, and the title and notes are on your clipboard.' :
                                        ' saved. Copy the title and notes with the button below.'}
                                </span>
                            ) : (
                                <span className={styles.stepText}>
                                    <FormattedMessage
                                        defaultMessage="Saves the project as a file and copies the title and notes."
                                        description="What the first step does"
                                        id="flipwarp.publish.step1"
                                    />
                                </span>
                            )}
                        </li>
                        <li>
                            <button
                                className={styles.go}
                                onClick={this.handleOpenScratch}
                                disabled={!file}
                            >
                                <FormattedMessage
                                    defaultMessage="Open Scratch"
                                    description="Button that opens the Scratch editor"
                                    id="flipwarp.publish.openScratch"
                                />
                            </button>
                            <span className={styles.stepText}>
                                <FormattedMessage
                                    // eslint-disable-next-line max-len
                                    defaultMessage="In Scratch: File, then Load from your computer, pick the file, then File and Save now. This is the part nobody outside Scratch is allowed to do for you."
                                    description="What the second step is"
                                    id="flipwarp.publish.step2"
                                />
                            </span>
                        </li>
                        <li>
                            <span className={styles.stepText}>
                                <FormattedMessage
                                    // eslint-disable-next-line max-len
                                    defaultMessage="Still on that Scratch page, press the Flipwarp bookmarklet. It sets the title and the notes, and shares the project if you asked it to."
                                    description="What the third step is"
                                    id="flipwarp.publish.step3"
                                />
                            </span>
                        </li>
                    </ol>

                    <div className={styles.buttons}>
                        <button
                            className={styles.quiet}
                            onClick={this.handleCopyTicket}
                        >
                            <FormattedMessage
                                defaultMessage="Copy the title and notes"
                                description="Button that copies the ticket again"
                                id="flipwarp.publish.copyTicket"
                            />
                        </button>
                        <button
                            className={styles.quiet}
                            onClick={this.handleCopyBookmarklet}
                        >
                            {copied === 'bookmarklet' ? 'Copied, now make a bookmark of it' :
                                'Copy the bookmarklet'}
                        </button>
                    </div>
                    <p className={styles.hint}>
                        <FormattedMessage
                            // eslint-disable-next-line max-len
                            defaultMessage="The bookmarklet is a bookmark whose address is a small program. Copy it, make a new bookmark in your bookmarks bar, and paste it in where the address goes. You only do this once."
                            description="How to install the bookmarklet"
                            id="flipwarp.publish.bookmarkletHint"
                        />
                    </p>
                </Box>
            </Modal>
        );
    }
}

PublishModal.propTypes = {
    intl: intlShape.isRequired,
    onClose: PropTypes.func.isRequired,
    projectTitle: PropTypes.string,
    vm: PropTypes.shape({
        saveProjectSb3: PropTypes.func
    }).isRequired
};

export default injectIntl(PublishModal);
