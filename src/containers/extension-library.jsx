import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import log from '../lib/log';

import extensionLibraryContent, {
    galleryError,
    galleryLoading,
    galleryMore
} from '../lib/libraries/extensions/index.jsx';
import extensionTags from '../lib/libraries/tw-extension-tags';
import {loadPenguinModLibrary} from '../lib/flipwarp/penguinmod-library';
import {flipwarpLibrary} from '../lib/flipwarp/flipwarp-extensions';
import libraryStyles from '../components/library/library.css';

import LibraryComponent from '../components/library/library.jsx';
import extensionIcon from '../components/action-menu/icon--sprite.svg';

const messages = defineMessages({
    extensionTitle: {
        defaultMessage: 'Choose an Extension',
        description: 'Heading for the extension library',
        id: 'gui.extensionLibrary.chooseAnExtension'
    }
});

const toLibraryItem = extension => {
    if (typeof extension === 'object') {
        return ({
            rawURL: extension.iconURL || extensionIcon,
            ...extension
        });
    }
    return extension;
};

const translateGalleryItem = (extension, locale) => ({
    ...extension,
    name: extension.nameTranslations[locale] || extension.name,
    description: extension.descriptionTranslations[locale] || extension.description
});

let cachedGallery = null;
let cachedPenguinMod = null;

const fetchLibrary = async () => {
    const res = await fetch('https://extensions.turbowarp.org/generated-metadata/extensions-v0.json');
    if (!res.ok) {
        throw new Error(`HTTP status ${res.status}`);
    }
    const data = await res.json();
    return data.extensions.map(extension => ({
        name: extension.name,
        nameTranslations: extension.nameTranslations || {},
        description: extension.description,
        descriptionTranslations: extension.descriptionTranslations || {},
        extensionId: extension.id,
        extensionURL: `https://extensions.turbowarp.org/${extension.slug}.js`,
        iconURL: `https://extensions.turbowarp.org/${extension.image || 'images/unknown.svg'}`,
        tags: ['tw'],
        credits: [
            ...(extension.original || []),
            ...(extension.by || [])
        ].map(credit => {
            if (credit.link) {
                return (
                    <a
                        href={credit.link}
                        target="_blank"
                        rel="noreferrer"
                        key={credit.name}
                    >
                        {credit.name}
                    </a>
                );
            }
            return credit.name;
        }),
        docsURI: extension.docs ? `https://extensions.turbowarp.org/${extension.slug}` : null,
        samples: extension.samples ? extension.samples.map(sample => ({
            href: `${process.env.ROOT}editor?project_url=https://extensions.turbowarp.org/samples/${encodeURIComponent(sample)}.sb3`,
            text: sample
        })) : null,
        incompatibleWithScratch: !extension.scratchCompatible,
        featured: true
    }));
};

class ExtensionLibrary extends React.PureComponent {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleItemSelect'
        ]);
        this.state = {
            gallery: cachedGallery,
            galleryError: null,
            galleryTimedOut: false,
            penguinMod: cachedPenguinMod
        };
    }
    componentDidMount () {
        if (!this.state.penguinMod) {
            loadPenguinModLibrary().then(penguinMod => {
                cachedPenguinMod = penguinMod;
                this.setState({penguinMod});
            });
        }

        if (!this.state.gallery) {
            const timeout = setTimeout(() => {
                this.setState({
                    galleryTimedOut: true
                });
            }, 750);

            fetchLibrary()
                .then(gallery => {
                    cachedGallery = gallery;
                    this.setState({
                        gallery
                    });
                    clearTimeout(timeout);
                })
                .catch(error => {
                    log.error(error);
                    this.setState({
                        galleryError: error
                    });
                    clearTimeout(timeout);
                });
        }
    }
    handleItemSelect (item) {
        if (item.href) {
            return;
        }

        const extensionId = item.extensionId;

        if (extensionId === 'custom_extension') {
            this.props.onOpenCustomExtensionModal();
            return;
        }

        if (extensionId === 'procedures_enable_return') {
            this.props.onEnableProcedureReturns();
            this.props.onCategorySelected('myBlocks');
            return;
        }

        const url = item.extensionURL ? item.extensionURL : extensionId;
        if (!item.disabled) {
            if (this.props.vm.extensionManager.isExtensionLoaded(extensionId)) {
                this.props.onCategorySelected(extensionId);
            } else {
                this.props.vm.extensionManager.loadExtensionURL(url)
                    .then(() => {
                        this.props.onCategorySelected(extensionId);
                    })
                    .catch(err => {
                        log.error(err);
                        // eslint-disable-next-line no-alert
                        alert(err);
                    });
            }
        }
    }
    render () {
        let library = null;
        if (this.state.gallery || this.state.galleryError || this.state.galleryTimedOut) {
            // Flipwarp's own first: they are the only ones on this list whose
            // blocks the Text button can read.
            library = flipwarpLibrary().map(toLibraryItem);
            library.push('---');
            library.push(...extensionLibraryContent.map(toLibraryItem));
            library.push('---');
            if (this.state.gallery) {
                library.push(toLibraryItem(galleryMore));
                const locale = this.props.intl.locale;
                library.push(
                    ...this.state.gallery
                        .filter(i => i.extensionId !== 'faceSensing')
                        .map(i => translateGalleryItem(i, locale))
                        .map(toLibraryItem)
                );
            } else if (this.state.galleryError) {
                library.push(toLibraryItem(galleryError));
            } else {
                library.push(toLibraryItem(galleryLoading));
            }

            if (this.state.penguinMod && this.state.penguinMod.length) {
                library.push(...this.state.penguinMod.map(toLibraryItem));
            }
        }

        // These extensions belong to TurboWarp. Their blocks run here, but
        // Flipwarp has no text form for them, so the Text button will refuse
        // on a sprite that uses one. Better to say so before you build with
        // them than after.
        const notice = (title, body, links = []) => (
            <React.Fragment>
                <div className={libraryStyles.tagBannerText}>
                    <div className={libraryStyles.tagBannerTitle}>{title}</div>
                    <div>{body}</div>
                </div>
                {links.map(link => (
                    <a
                        className={libraryStyles.tagBannerLink}
                        href={link.href}
                        key={link.href}
                        rel="noopener noreferrer"
                        target="_blank"
                    >{link.text}</a>
                ))}
            </React.Fragment>
        );
        const turboWarpLink = {href: 'https://turbowarp.org/editor', text: 'Open TurboWarp'};
        const penguinModLink = {href: 'https://studio.penguinmod.com/editor.html', text: 'Open PenguinMod'};

        // On the TurboWarp tab everything shown is theirs. On All they sit
        // mixed in with Scratch's own extensions, which do convert to text,
        // so the wording has to be narrower there or it would be wrong.
        const turboWarpNotice = notice(
            'These extensions are made by TurboWarp.',
            'Their blocks work in Flipwarp, but Flipwarp cannot show them as text — the Text ' +
            'button will refuse on a sprite that uses one. If you want the full set of these ' +
            'extensions, TurboWarp\'s own editor supports them.',
            [turboWarpLink]
        );

        // The PenguinMod tab lists whatever is in the penguinmod folder of
        // this site. Two different things to say depending on whether that
        // folder is there.
        const havePenguinMod = !!(this.state.penguinMod && this.state.penguinMod.length);
        const penguinModNotice = havePenguinMod ? notice(
            'These extensions are made by PenguinMod.',
            'Their blocks work in Flipwarp, but Flipwarp cannot show them as text — the Text ' +
            'button will refuse on a sprite that uses one. They were also written for ' +
            'PenguinMod\'s engine, so one may want something this editor does not have; if a ' +
            'block misbehaves, PenguinMod\'s own editor is where it is guaranteed to work.',
            [penguinModLink]
        ) : notice(
            'No PenguinMod extensions have been added to this site yet.',
            'Open flipwarp-check.html on this site, run the check, then press Download a copy of ' +
            'every extension. Unzip what you get into the same folder as editor.html, so that a ' +
            'folder called penguinmod sits beside it, and reload. This tab will list them.'
        );

        const flipwarpNotice = notice(
            'These are Flipwarp\'s own, by E1GAT0_.',
            'They do the things Scratch projects keep rebuilding by hand — remembering a score ' +
            'after the tab closes, replaying what was pressed, holding a branching conversation. ' +
            'Unlike everything under the other tabs, their blocks convert to text like any other ' +
            'block, so the Text button still works on a sprite that uses one.'
        );

        const allTabNotice = notice(
            'Anything under the TurboWarp tab cannot be shown as text.',
            'Scratch\'s own extensions — Music, Pen, Video Sensing and the rest — convert to text ' +
            'like any other block. TurboWarp\'s and PenguinMod\'s do not: their blocks work, but ' +
            'the Text button will refuse on a sprite that uses one.',
            [turboWarpLink, penguinModLink]
        );

        return (
            <LibraryComponent
                data={library}
                filterable
                persistableKey="extensionId"
                id="extensionLibrary"
                tagBanners={{
                    all: allTabNotice,
                    flipwarp: flipwarpNotice,
                    tw: turboWarpNotice,
                    pm: penguinModNotice
                }}
                tags={extensionTags}
                title={this.props.intl.formatMessage(messages.extensionTitle)}
                visible={this.props.visible}
                onItemSelected={this.handleItemSelect}
                onRequestClose={this.props.onRequestClose}
            />
        );
    }
}

ExtensionLibrary.propTypes = {
    intl: intlShape.isRequired,
    onCategorySelected: PropTypes.func,
    onEnableProcedureReturns: PropTypes.func,
    onOpenCustomExtensionModal: PropTypes.func,
    onRequestClose: PropTypes.func,
    visible: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired // eslint-disable-line react/no-unused-prop-types
};

export default injectIntl(ExtensionLibrary);
