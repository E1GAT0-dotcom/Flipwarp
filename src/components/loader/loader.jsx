import React from 'react';
import {FormattedMessage, injectIntl, intlShape, defineMessages} from 'react-intl';
import {connect} from 'react-redux';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import bindAll from 'lodash.bindall';
import styles from './loader.css';
import {getIsLoadingWithId} from '../../reducers/project-state';
import {FLIPWARP_ASSET} from '../../lib/flipwarp/loading-assets';
import topBlock from './top-block.svg';
import middleBlock from './middle-block.svg';
import bottomBlock from './bottom-block.svg';

const mainMessages = {
    'gui.loader.headline': (
        <FormattedMessage
            defaultMessage="Loading Project"
            description="Main loading message"
            id="gui.loader.headline"
        />
    ),
    'gui.loader.creating': (
        <FormattedMessage
            defaultMessage="Creating Project"
            description="Main creating message"
            id="gui.loader.creating"
        />
    )
};

const messages = defineMessages({
    projectData: {
        defaultMessage: 'Loading project …',
        description: 'Appears when loading project data, but not assets yet',
        id: 'tw.loader.projectData'
    },
    downloadingAssets: {
        defaultMessage: 'Downloading assets ({complete}/{total}) …',
        description: 'Appears when loading project assets from a project on a remote website',
        id: 'tw.loader.downloadingAssets'
    },
    loadingAssets: {
        defaultMessage: 'Loading assets ({complete}/{total}) …',
        description: 'Appears when loading project assets from a project file on the user\'s computer',
        id: 'tw.loader.loadingAssets'
    }
});

// Because progress events are fired so often during the very performance-critical loading
// process and React updates are very slow, we bypass React for updating the progress bar.

class LoaderComponent extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleAssetProgress',
            'handleAsset',
            'handleProjectLoaded',
            'barInnerRef',
            'barOuterRef',
            'percentRef',
            'percentFillRef',
            'assetRef',
            'messageRef'
        ]);
        this.barInnerEl = null;
        this.barOuterEl = null;
        this.percentEl = null;
        this.percentFillEl = null;
        this.assetEl = null;
        this.messageEl = null;
        this.ignoreProgress = false;
    }
    componentDidMount () {
        this.handleAssetProgress(
            this.props.vm.runtime.finishedAssetRequests,
            this.props.vm.runtime.totalAssetRequests
        );
        this.props.vm.on('ASSET_PROGRESS', this.handleAssetProgress);
        this.props.vm.on(FLIPWARP_ASSET, this.handleAsset);
        this.props.vm.runtime.on('PROJECT_LOADED', this.handleProjectLoaded);
    }
    componentWillUnmount () {
        this.props.vm.off('ASSET_PROGRESS', this.handleAssetProgress);
        this.props.vm.off(FLIPWARP_ASSET, this.handleAsset);
        this.props.vm.runtime.off('PROJECT_LOADED', this.handleProjectLoaded);
    }
    setPercent (fraction) {
        const shown = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
        if (this.percentEl) this.percentEl.textContent = shown;
        if (this.percentFillEl) {
            this.percentFillEl.textContent = shown;
            // The clipped copy has to be as wide as the whole bar, or it
            // would centre itself inside the fill and drift as it grows.
            if (this.barOuterEl) {
                this.percentFillEl.style.width = `${this.barOuterEl.offsetWidth}px`;
            }
        }
    }
    handleAsset (info) {
        if (this.ignoreProgress || !this.assetEl || !info) return;
        // Rebuilt rather than set as text so the sprite can be picked out
        // from the costume without a second element per update.
        this.assetEl.textContent = '';
        const sprite = document.createElement('span');
        sprite.className = this.props.spriteClass;
        sprite.textContent = info.sprite || '';
        const kind = document.createElement('span');
        kind.className = this.props.kindClass;
        kind.textContent = info.kind === 'sound' ? ' sound ' : ' costume ';
        this.assetEl.appendChild(sprite);
        this.assetEl.appendChild(kind);
        this.assetEl.appendChild(document.createTextNode(info.name || ''));
    }
    handleAssetProgress (finished, total) {
        if (this.ignoreProgress || !this.barInnerEl || !this.messageEl) {
            return;
        }

        if (total === 0) {
            // Started loading a new project.
            this.barInnerEl.style.width = '0';
            this.setPercent(0);
            if (this.assetEl) this.assetEl.textContent = '';
            this.messageEl.textContent = this.props.intl.formatMessage(messages.projectData);
        } else {
            this.barInnerEl.style.width = `${finished / total * 100}%`;
            this.setPercent(finished / total);
            const message = this.props.isRemote ? messages.downloadingAssets : messages.loadingAssets;
            this.messageEl.textContent = this.props.intl.formatMessage(message, {
                complete: finished,
                total
            });
        }
    }
    handleProjectLoaded () {
        if (this.ignoreProgress || !this.barInnerEl || !this.messageEl) {
            return;
        }

        this.ignoreProgress = true;
        this.props.vm.runtime.resetProgress();
    }
    barInnerRef (barInner) {
        this.barInnerEl = barInner;
    }
    barOuterRef (barOuter) {
        this.barOuterEl = barOuter;
    }
    percentRef (percent) {
        this.percentEl = percent;
    }
    percentFillRef (percent) {
        this.percentFillEl = percent;
    }
    assetRef (asset) {
        this.assetEl = asset;
    }
    messageRef (message) {
        this.messageEl = message;
    }
    render () {
        return (
            <div
                className={classNames(styles.background, {
                    [styles.fullscreen]: this.props.isFullScreen
                })}
            >
                <div className={styles.container}>
                    <div className={styles.blockAnimation}>
                        <img
                            className={styles.topBlock}
                            src={topBlock}
                            draggable={false}
                        />
                        <img
                            className={styles.middleBlock}
                            src={middleBlock}
                            draggable={false}
                        />
                        <img
                            className={styles.bottomBlock}
                            src={bottomBlock}
                            draggable={false}
                        />
                    </div>

                    <div className={styles.title}>
                        {mainMessages[this.props.messageId]}
                    </div>

                    <div
                        className={styles.message}
                        ref={this.messageRef}
                    />

                    <div
                        className={styles.barOuter}
                        ref={this.barOuterRef}
                    >
                        <div
                            className={styles.barPercent}
                            ref={this.percentRef}
                        />
                        <div
                            className={styles.barInner}
                            ref={this.barInnerRef}
                        >
                            <div
                                className={styles.barPercentFill}
                                ref={this.percentFillRef}
                            />
                        </div>
                    </div>

                    <div
                        className={styles.assetLine}
                        ref={this.assetRef}
                    />
                </div>
            </div>
        );
    }
}

LoaderComponent.propTypes = {
    intl: intlShape,
    isFullScreen: PropTypes.bool,
    isRemote: PropTypes.bool,
    kindClass: PropTypes.string,
    messageId: PropTypes.string,
    spriteClass: PropTypes.string,
    vm: PropTypes.shape({
        on: PropTypes.func,
        off: PropTypes.func,
        runtime: PropTypes.shape({
            totalAssetRequests: PropTypes.number,
            finishedAssetRequests: PropTypes.number,
            resetProgress: PropTypes.func,
            on: PropTypes.func,
            off: PropTypes.func
        })
    })
};
LoaderComponent.defaultProps = {
    isFullScreen: false,
    messageId: 'gui.loader.headline',
    spriteClass: styles.assetSprite,
    kindClass: styles.assetKind
};

const mapStateToProps = state => ({
    isRemote: getIsLoadingWithId(state.scratchGui.projectState.loadingState),
    vm: state.scratchGui.vm
});

const mapDispatchToProps = () => ({});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(injectIntl(LoaderComponent));
