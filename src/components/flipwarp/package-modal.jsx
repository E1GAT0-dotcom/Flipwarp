import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import {FormattedMessage, defineMessages, injectIntl, intlShape} from 'react-intl';

import Box from '../box/box.jsx';
import Modal from '../../containers/modal.jsx';
import {KINDS, fullPackagerUrl, packageProject} from '../../lib/flipwarp/package-project.js';
import styles from './package-modal.css';

const messages = defineMessages({
    title: {
        defaultMessage: 'Package',
        description: 'Title of the packaging dialog',
        id: 'flipwarp.package.title'
    }
});

// What to say while it works. The packager reports several stages and most of
// them mean nothing to anybody who has not read its source, so they are
// grouped into the three things that actually take time.
const STAGE_TEXT = {
    reading: 'Reading the project',
    loading: 'Getting the packager',
    assets: 'Collecting costumes and sounds',
    compress: 'Packing',
    packing: 'Packing',
    fetching: 'Fetching what it needs',
    done: 'Done'
};

/**
 * Three questions and a button.
 *
 * Everything else the packager would ask — the framerate, the stage size, the
 * clone limit, whether the compiler is on — is already set in the editor you
 * pressed this from, so it is copied rather than asked for again. That is the
 * whole idea: the packager website has to ask because it has never seen your
 * project, and this has.
 */
class PackageModal extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleKind',
            'handleName',
            'handleAutoplay',
            'handleGo',
            'handleProgress'
        ]);
        this.state = {
            kind: KINDS[0].id,
            name: props.projectTitle || 'project',
            autoplay: false,
            busy: false,
            stage: null,
            percent: 0,
            error: null,
            made: null
        };
    }

    componentWillUnmount () {
        // A file offered but never saved would otherwise sit in memory for as
        // long as the tab is open.
        if (this.state.made) URL.revokeObjectURL(this.state.made.url);
    }

    handleKind (e) {
        this.setState({kind: e.target.value});
    }

    handleName (e) {
        this.setState({name: e.target.value});
    }

    handleAutoplay (e) {
        this.setState({autoplay: e.target.checked});
    }

    handleProgress ({stage, percent}) {
        this.setState({stage, percent: Number.isFinite(percent) ? percent : 0});
    }

    async handleGo () {
        if (this.state.busy) return;
        if (this.state.made) URL.revokeObjectURL(this.state.made.url);
        this.setState({busy: true, error: null, made: null, stage: 'reading', percent: 0});
        try {
            const file = await packageProject({
                vm: this.props.vm,
                title: this.state.name,
                kind: this.state.kind,
                autoplay: this.state.autoplay,
                onProgress: this.handleProgress
            });
            const url = URL.createObjectURL(new Blob([file.data], {type: file.type}));
            this.setState({busy: false, made: {url, name: file.name, size: file.data.length}});
        } catch (e) {
            // Shown rather than only logged: a dialog that goes quiet is a
            // dialog nobody can act on.
            this.setState({busy: false, error: e && e.message ? e.message : String(e)});
        }
    }

    render () {
        const {intl} = this.props;
        const {busy, made, error} = this.state;
        return (
            <Modal
                className={styles.modalContent}
                onRequestClose={this.props.onClose}
                contentLabel={intl.formatMessage(messages.title)}
                id="packageModal"
            >
                <Box className={styles.body}>
                    <p className={styles.lead}>
                        <FormattedMessage
                            // eslint-disable-next-line max-len
                            defaultMessage="Turns this project into something you can hand to somebody who does not have Flipwarp. How it runs — the framerate, the stage size, the clone limit — is taken from this project, so there is nothing to set up twice."
                            description="Explanation at the top of the packaging dialog"
                            id="flipwarp.package.lead"
                        />
                    </p>

                    <div className={styles.field}>
                        <div className={styles.fieldLabel}>
                            <FormattedMessage
                                defaultMessage="What do you want?"
                                description="Label for the kind of package"
                                id="flipwarp.package.kind"
                            />
                        </div>
                        {KINDS.map(kind => (
                            <label
                                key={kind.id}
                                className={styles.choice}
                            >
                                <input
                                    type="radio"
                                    name="flipwarp-package-kind"
                                    value={kind.id}
                                    checked={this.state.kind === kind.id}
                                    onChange={this.handleKind}
                                    disabled={busy}
                                />
                                <span>
                                    <strong>{kind.label}</strong>
                                    <span className={styles.choiceDetail}>{kind.detail}</span>
                                </span>
                            </label>
                        ))}
                    </div>

                    <div className={styles.field}>
                        <label className={styles.inline}>
                            <FormattedMessage
                                defaultMessage="Call it"
                                description="Label for the packaged file's name"
                                id="flipwarp.package.name"
                            />
                            <input
                                type="text"
                                className={styles.text}
                                value={this.state.name}
                                onChange={this.handleName}
                                disabled={busy}
                            />
                        </label>
                    </div>

                    <div className={styles.field}>
                        <label className={styles.inline}>
                            <input
                                type="checkbox"
                                checked={this.state.autoplay}
                                onChange={this.handleAutoplay}
                                disabled={busy}
                            />
                            <FormattedMessage
                                defaultMessage="Start on its own"
                                description="Label for the autoplay option"
                                id="flipwarp.package.autoplay"
                            />
                        </label>
                        <p className={styles.hint}>
                            <FormattedMessage
                                // eslint-disable-next-line max-len
                                defaultMessage="Off, it opens with a green flag to press. On, it runs the moment it is opened — which some browsers will not allow to make sound until something is clicked."
                                description="Help for the autoplay option"
                                id="flipwarp.package.autoplayHint"
                            />
                        </p>
                    </div>

                    {busy && (
                        <div className={styles.progress}>
                            <div className={styles.progressLabel}>
                                {STAGE_TEXT[this.state.stage] || 'Working'}
                                {'…'}
                            </div>
                            <div className={styles.progressTrack}>
                                <div
                                    className={styles.progressBar}
                                    style={{width: `${Math.round(Math.min(1, this.state.percent) * 100)}%`}}
                                />
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className={styles.error}>
                            <FormattedMessage
                                defaultMessage="It could not be packaged: {error}"
                                description="Shown when packaging fails"
                                id="flipwarp.package.error"
                                values={{error}}
                            />
                        </div>
                    )}

                    <div className={styles.buttons}>
                        {made ? (
                            <a
                                className={styles.go}
                                href={made.url}
                                download={made.name}
                            >
                                <FormattedMessage
                                    defaultMessage="Save {name} ({size})"
                                    description="Button to save the packaged file"
                                    id="flipwarp.package.save"
                                    values={{
                                        name: made.name,
                                        size: `${Math.max(1, Math.round(made.size / 1024 / 1024 * 10) / 10)} MB`
                                    }}
                                />
                            </a>
                        ) : (
                            <button
                                className={styles.go}
                                onClick={this.handleGo}
                                disabled={busy}
                            >
                                <FormattedMessage
                                    defaultMessage="Make it"
                                    description="Button that starts packaging"
                                    id="flipwarp.package.go"
                                />
                            </button>
                        )}
                    </div>

                    <p className={styles.more}>
                        <FormattedMessage
                            // eslint-disable-next-line max-len
                            defaultMessage="A Windows, macOS, Linux or Android app has to be built by a program rather than a web page, and there are far more settings than these. {link} does both."
                            description="Pointer to the full packager"
                            id="flipwarp.package.more"
                            values={{
                                link: (
                                    <a
                                        href={fullPackagerUrl()}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >{'The TurboWarp Packager'}</a>
                                )
                            }}
                        />
                    </p>
                </Box>
            </Modal>
        );
    }
}

PackageModal.propTypes = {
    intl: intlShape.isRequired,
    onClose: PropTypes.func.isRequired,
    projectTitle: PropTypes.string,
    vm: PropTypes.shape({
        saveProjectSb3: PropTypes.func
    }).isRequired
};

export default injectIntl(PackageModal);
