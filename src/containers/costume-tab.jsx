import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import {defineMessages, intlShape, injectIntl} from 'react-intl';
import VM from 'scratch-vm';

import AssetPanel from '../components/asset-panel/asset-panel.jsx';
import PaintEditorWrapper from './paint-editor-wrapper.jsx';
import {connect} from 'react-redux';
import {handleFileUpload, costumeUpload} from '../lib/file-uploader.js';
import errorBoundaryHOC from '../lib/error-boundary-hoc.jsx';
import DragConstants from '../lib/drag-constants';
import {emptyCostume} from '../lib/empty-assets';
import {setFolder, folderOf, foldersIn, groupedOrder, installCostumeFolders} from '../lib/flipwarp/costume-folders.js';
import sharedMessages from '../lib/shared-messages';
import downloadBlob from '../lib/download-blob';

import {
    openCostumeLibrary,
    openBackdropLibrary
} from '../reducers/modals';

import {
    activateTab,
    SOUNDS_TAB_INDEX
} from '../reducers/editor-tab';

import {setRestore} from '../reducers/restore-deletion';
import {showStandardAlert, closeAlertWithId} from '../reducers/alerts';

import addLibraryBackdropIcon from '../components/asset-panel/icon--add-backdrop-lib.svg';
import addLibraryCostumeIcon from '../components/asset-panel/icon--add-costume-lib.svg';
import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';
import paintIcon from '../components/action-menu/icon--paint.svg';
import surpriseIcon from '../components/action-menu/icon--surprise.svg';
import searchIcon from '../components/action-menu/icon--search.svg';

import {getCostumeLibrary, getBackdropLibrary} from '../lib/libraries/tw-async-libraries';

let messages = defineMessages({
    addLibraryBackdropMsg: {
        defaultMessage: 'Choose a Backdrop',
        description: 'Button to add a backdrop in the editor tab',
        id: 'gui.costumeTab.addBackdropFromLibrary'
    },
    addLibraryCostumeMsg: {
        defaultMessage: 'Choose a Costume',
        description: 'Button to add a costume in the editor tab',
        id: 'gui.costumeTab.addCostumeFromLibrary'
    },
    addBlankCostumeMsg: {
        defaultMessage: 'Paint',
        description: 'Button to add a blank costume in the editor tab',
        id: 'gui.costumeTab.addBlankCostume'
    },
    addSurpriseCostumeMsg: {
        defaultMessage: 'Surprise',
        description: 'Button to add a surprise costume in the editor tab',
        id: 'gui.costumeTab.addSurpriseCostume'
    },
    addFileBackdropMsg: {
        defaultMessage: 'Upload Backdrop',
        description: 'Button to add a backdrop by uploading a file in the editor tab',
        id: 'gui.costumeTab.addFileBackdrop'
    },
    addFileCostumeMsg: {
        defaultMessage: 'Upload Costume',
        description: 'Button to add a costume by uploading a file in the editor tab',
        id: 'gui.costumeTab.addFileCostume'
    }
});

messages = {...messages, ...sharedMessages};

class CostumeTab extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleSelectCostume',
            'handleClearSelection',
            'handleDeleteSelected',
            'handleDuplicateSelected',
            'handleExportSelected',
            'handleToggleFolder',
            'handleMoveToFolder',
            'handleDeleteCostume',
            'handleDuplicateCostume',
            'handleExportCostume',
            'handleNewCostume',
            'handleNewBlankCostume',
            'handleSurpriseCostume',
            'handleSurpriseBackdrop',
            'handleFileUploadClick',
            'handleCostumeUpload',
            'handleDrop',
            'setFileInput'
        ]);
        const {
            editingTarget,
            sprites,
            stage
        } = props;
        const target = editingTarget && sprites[editingTarget] ? sprites[editingTarget] : stage;
        if (target && target.currentCostume) {
            this.state = {selectedCostumeIndex: target.currentCostume, selectedIndices: []};
        } else {
            this.state = {selectedCostumeIndex: 0, selectedIndices: []};
        }
        // Where a shift-click measures from: the last one picked on its own.
        this.anchorIndex = null;
        // Which modifier keys were down for the click being handled.
        //
        // Read from the click itself rather than taken from whoever forwards
        // it, because the Folders addon replaces the costume list's items and
        // calls back with the number alone — the keys never survive the trip.
        // Watching in the capture phase means this runs before anything that
        // could swallow the event, whoever ends up handling it.
        // Folders the person has closed, by name. Kept per sprite and only
        // while the editor is open: which folders are shut is a view, not
        // something about the project.
        this.collapsed = {};
        this.lastKeys = {ctrl: false, shift: false, at: 0};
        this.rememberKeys = e => {
            this.lastKeys = {
                ctrl: e.ctrlKey || e.metaKey,
                shift: e.shiftKey,
                at: Date.now()
            };
        };
    }

    // The keys from the click happening now. Anything older than a moment ago
    // belongs to a different click and is ignored, so a stale ctrl can never
    // turn an ordinary click into an adding one.
    heldKeys () {
        const fresh = Date.now() - this.lastKeys.at < 1000;
        return fresh ? this.lastKeys : {ctrl: false, shift: false};
    }
    componentDidMount () {
        document.addEventListener('mousedown', this.rememberKeys, true);
        // Makes folders survive being saved and opened again. Safe to call
        // more than once; only the first does anything.
        installCostumeFolders(this.props.vm);
    }

    componentWillUnmount () {
        document.removeEventListener('mousedown', this.rememberKeys, true);
    }

    componentWillReceiveProps (nextProps) {
        const {
            editingTarget,
            sprites,
            stage
        } = nextProps;

        const target = editingTarget && sprites[editingTarget] ? sprites[editingTarget] : stage;
        if (!target || !target.costumes) {
            return;
        }

        if (this.props.editingTarget === editingTarget) {
            // If costumes have been added or removed, change costumes to the editing target's
            // current costume.
            const oldTarget = this.props.sprites[editingTarget] ?
                this.props.sprites[editingTarget] : this.props.stage;
            // @todo: Find and switch to the index of the costume that is new. This is blocked by
            // https://github.com/LLK/scratch-vm/issues/967
            // Right now, you can land on the wrong costume if a costume changing script is running.
            if (oldTarget.costumeCount !== target.costumeCount) {
                this.setState({selectedCostumeIndex: target.currentCostume, selectedIndices: []});
            }
        } else {
            // If switching editing targets, update the costume index
            // A different sprite has different costumes, so anything picked
            // out in the old one means nothing here.
            this.anchorIndex = null;
            this.setState({selectedCostumeIndex: target.currentCostume, selectedIndices: []});
        }
    }
    // Clicking a costume. Plain click picks that one and forgets any others;
    // ctrl or cmd adds and removes one at a time; shift takes everything
    // between it and the last one you picked. Those are the rules every file
    // list uses, so nobody has to be told them.
    //
    // The costume being edited follows the click either way: picking several
    // to delete should still show you the one you last touched.
    handleSelectCostume (costumeIndex, modifiers) {
        const held = modifiers && (modifiers.ctrl || modifiers.shift) ? modifiers : this.heldKeys();
        const costumes = this.props.vm.editingTarget.getCostumes();
        const chosen = this.state.selectedIndices;

        let next;
        if (held.shift && this.anchorIndex !== null) {
            const from = Math.min(this.anchorIndex, costumeIndex);
            const to = Math.max(this.anchorIndex, costumeIndex);
            next = [];
            for (let i = from; i <= to; i++) next.push(i);
        } else if (held.ctrl) {
            next = chosen.includes(costumeIndex) ?
                chosen.filter(i => i !== costumeIndex) :
                [...chosen, costumeIndex];
            this.anchorIndex = costumeIndex;
        } else {
            next = [costumeIndex];
            this.anchorIndex = costumeIndex;
        }

        // Anything that scrolled off the end of a shorter list is dropped, so
        // a stale number can never be acted on.
        next = next.filter(i => i >= 0 && i < costumes.length);

        this.props.vm.editingTarget.setCostume(costumeIndex);
        this.setState({selectedCostumeIndex: costumeIndex, selectedIndices: next});
    }

    handleClearSelection () {
        this.setState(old => ({selectedIndices: [old.selectedCostumeIndex]}));
    }

    // The chosen ones, newest index first. Deleting or duplicating from the
    // end means the numbers of the ones still to come cannot shift underneath
    // us — which is the whole reason a batch delete goes wrong when it does.
    selectedDescending () {
        return [...new Set(this.state.selectedIndices)].sort((a, b) => b - a);
    }

    handleDeleteSelected () {
        const target = this.props.vm.editingTarget;
        const total = target.getCostumes().length;
        const doomed = this.selectedDescending();
        // A sprite must keep one. Rather than refuse the whole thing, the
        // first costume is kept back and everything else goes.
        const keeping = doomed.length >= total ? doomed.slice(0, total - 1) : doomed;
        for (const index of keeping) {
            const restore = this.props.vm.deleteCostume(index);
            this.props.dispatchUpdateRestore({restoreFun: restore, deletedItem: 'Costume'});
        }
        this.anchorIndex = null;
        this.setState({selectedIndices: [], selectedCostumeIndex: 0});
    }

    handleDuplicateSelected () {
        for (const index of this.selectedDescending()) {
            this.props.vm.duplicateCostume(index);
        }
        this.anchorIndex = null;
        this.setState({selectedIndices: []});
    }

    handleToggleFolder (name) {
        const target = this.props.vm.editingTarget;
        const key = `${target ? target.id : ''}:${name}`;
        this.collapsed[key] = !this.collapsed[key];
        this.forceUpdate();
    }

    isCollapsed (name) {
        const target = this.props.vm.editingTarget;
        return !!this.collapsed[`${target ? target.id : ''}:${name}`];
    }

    // Move everything picked out into a folder, or out of one when the name
    // is empty. The costumes themselves do not move: a folder is a label, so
    // the sprite's order is left exactly as it was.
    handleMoveToFolder (name) {
        const costumes = this.props.vm.editingTarget.getCostumes();
        for (const index of this.state.selectedIndices) {
            if (costumes[index]) setFolder(costumes[index], name);
        }
        this.props.vm.emitTargetsUpdate();
        this.props.vm.runtime.emitProjectChanged();
        this.forceUpdate();
    }

    handleExportSelected () {
        // Oldest first here, so the files arrive in the order they appear in
        // the list rather than backwards.
        for (const index of [...this.state.selectedIndices].sort((a, b) => a - b)) {
            this.handleExportCostume(index);
        }
    }
    handleDeleteCostume (costumeIndex) {
        const restoreCostumeFun = this.props.vm.deleteCostume(costumeIndex);
        this.props.dispatchUpdateRestore({
            restoreFun: restoreCostumeFun,
            deletedItem: 'Costume'
        });
    }
    handleDuplicateCostume (costumeIndex) {
        this.props.vm.duplicateCostume(costumeIndex);
    }
    handleExportCostume (costumeIndex) {
        const item = this.props.vm.editingTarget.sprite.costumes[costumeIndex];
        const blob = new Blob([
            this.props.vm.getExportedCostume(item)
        ], {type: item.asset.assetType.contentType});
        downloadBlob(`${item.name}.${item.asset.dataFormat}`, blob);
    }
    handleNewCostume (costume, fromCostumeLibrary, targetId) {
        const costumes = Array.isArray(costume) ? costume : [costume];

        return Promise.all(costumes.map(c => {
            if (fromCostumeLibrary) {
                return this.props.vm.addCostumeFromLibrary(c.md5, c);
            }
            // If targetId is falsy, VM should default it to editingTarget.id
            // However, targetId should be provided to prevent #5876,
            // if making new costume takes a while
            return this.props.vm.addCostume(c.md5, c, targetId);
        }));
    }
    handleNewBlankCostume () {
        const name = this.props.vm.editingTarget.isStage ?
            this.props.intl.formatMessage(messages.backdrop, {index: 1}) :
            this.props.intl.formatMessage(messages.costume, {index: 1});
        this.handleNewCostume(emptyCostume(name));
    }
    async handleSurpriseCostume () {
        const costumeLibraryContent = await getCostumeLibrary();
        const item = costumeLibraryContent[Math.floor(Math.random() * costumeLibraryContent.length)];
        const vmCostume = {
            name: item.name,
            md5: item.md5ext,
            rotationCenterX: item.rotationCenterX,
            rotationCenterY: item.rotationCenterY,
            bitmapResolution: item.bitmapResolution,
            skinId: null
        };
        this.handleNewCostume(vmCostume, true /* fromCostumeLibrary */);
    }
    async handleSurpriseBackdrop () {
        const backdropLibraryContent = await getBackdropLibrary();
        const item = backdropLibraryContent[Math.floor(Math.random() * backdropLibraryContent.length)];
        const vmCostume = {
            name: item.name,
            md5: item.md5ext,
            rotationCenterX: item.rotationCenterX,
            rotationCenterY: item.rotationCenterY,
            bitmapResolution: item.bitmapResolution,
            skinId: null
        };
        this.handleNewCostume(vmCostume);
    }
    handleCostumeUpload (e) {
        const vm = this.props.vm;
        const targetId = this.props.vm.editingTarget.id;
        this.props.onShowImporting();
        handleFileUpload(e.target, (buffer, fileType, fileName, fileIndex, fileCount) => {
            costumeUpload(buffer, fileType, vm, vmCostumes => {
                vmCostumes.forEach((costume, i) => {
                    costume.name = `${fileName}${i ? i + 1 : ''}`;
                });
                this.handleNewCostume(vmCostumes, false, targetId).then(() => {
                    if (fileIndex === fileCount - 1) {
                        this.props.onCloseImporting();
                    }
                });
            }, this.props.onCloseImporting);
        }, this.props.onCloseImporting);
    }
    handleFileUploadClick () {
        this.fileInput.click();
    }
    handleDrop (dropInfo) {
        if (dropInfo.dragType === DragConstants.COSTUME) {
            const sprite = this.props.vm.editingTarget.sprite;
            const activeCostume = sprite.costumes[this.state.selectedCostumeIndex];
            this.props.vm.reorderCostume(this.props.vm.editingTarget.id,
                dropInfo.index, dropInfo.newIndex);
            this.setState({selectedCostumeIndex: sprite.costumes.indexOf(activeCostume)});
        } else if (dropInfo.dragType === DragConstants.BACKPACK_COSTUME) {
            this.props.vm.addCostume(dropInfo.payload.body, {
                name: dropInfo.payload.name
            });
        } else if (dropInfo.dragType === DragConstants.BACKPACK_SOUND) {
            this.props.onActivateSoundsTab();
            this.props.vm.addSound({
                md5: dropInfo.payload.body,
                name: dropInfo.payload.name
            });
        }
    }
    setFileInput (input) {
        this.fileInput = input;
    }
    formatCostumeDetails (size, optResolution) {
        // If no resolution is given, assume that the costume is an SVG
        const resolution = optResolution ? optResolution : 1;
        // Convert size to stage units by dividing by resolution
        // Round up width and height for scratch-flash compatibility
        // https://github.com/LLK/scratch-flash/blob/9fbac92ef3d09ceca0c0782f8a08deaa79e4df69/src/ui/media/MediaInfo.as#L224-L237
        return `${Math.ceil(size[0] / resolution)} x ${Math.ceil(size[1] / resolution)}`;
    }
    render () {
        const {
            dispatchUpdateRestore, // eslint-disable-line no-unused-vars
            intl,
            isRtl,
            onNewLibraryBackdropClick,
            onNewLibraryCostumeClick,
            vm
        } = this.props;

        if (!vm.editingTarget) {
            return null;
        }

        const isStage = vm.editingTarget.isStage;
        const target = vm.editingTarget.sprite;

        const addLibraryMessage = isStage ? messages.addLibraryBackdropMsg : messages.addLibraryCostumeMsg;
        const addFileMessage = isStage ? messages.addFileBackdropMsg : messages.addFileCostumeMsg;
        const addSurpriseFunc = isStage ? this.handleSurpriseBackdrop : this.handleSurpriseCostume;
        const addLibraryFunc = isStage ? onNewLibraryBackdropClick : onNewLibraryCostumeClick;
        const addLibraryIcon = isStage ? addLibraryBackdropIcon : addLibraryCostumeIcon;

        const costumeData = target.costumes ? target.costumes.map(costume => ({
            name: costume.name,
            asset: costume.asset,
            details: costume.size ? this.formatCostumeDetails(costume.size, costume.bitmapResolution) : null,
            dragPayload: costume
        })) : [];

        // Where each costume sits on screen once folders are taken into
        // account, and where each folder's own line goes. The costumes are
        // not moved — only shown in a different order.
        const costumes = target.costumes || [];
        const rows = groupedOrder(costumes);
        const displayOrder = new Array(costumes.length).fill(0);
        const headerAt = {};
        let position = 0;
        let lastFolder;
        for (const row of rows) {
            if (row.folder && row.folder !== lastFolder) headerAt[row.folder] = position++;
            lastFolder = row.folder;
            displayOrder[row.index] = position++;
        }
        const folderHeaders = foldersIn(costumes).map(name => ({
            name,
            position: headerAt[name],
            count: costumes.filter(c => folderOf(c) === name).length,
            collapsed: this.isCollapsed(name)
        }));
        const hiddenIndices = costumes
            .map((costume, index) => ({costume, index}))
            .filter(({costume}) => folderOf(costume) && this.isCollapsed(folderOf(costume)))
            .map(({index}) => index);

        return (
            <AssetPanel
                buttons={[
                    {
                        title: intl.formatMessage(addLibraryMessage),
                        img: addLibraryIcon,
                        onClick: addLibraryFunc
                    },
                    {
                        title: intl.formatMessage(addFileMessage),
                        img: fileUploadIcon,
                        onClick: this.handleFileUploadClick,
                        fileAccept: '.svg, .png, .bmp, .jpg, .jpeg, .jfif, .webp, .gif',
                        fileChange: this.handleCostumeUpload,
                        fileInput: this.setFileInput,
                        fileMultiple: true
                    },
                    {
                        title: intl.formatMessage(messages.addSurpriseCostumeMsg),
                        img: surpriseIcon,
                        onClick: addSurpriseFunc
                    },
                    {
                        title: intl.formatMessage(messages.addBlankCostumeMsg),
                        img: paintIcon,
                        onClick: this.handleNewBlankCostume
                    },
                    {
                        title: intl.formatMessage(addLibraryMessage),
                        img: searchIcon,
                        onClick: addLibraryFunc
                    }
                ]}
                dragType={DragConstants.COSTUME}
                isRtl={isRtl}
                items={costumeData}
                displayOrder={displayOrder}
                folderHeaders={folderHeaders}
                folders={foldersIn(costumes)}
                hiddenIndices={hiddenIndices}
                selectedIndices={this.state.selectedIndices}
                selectedItemIndex={this.state.selectedCostumeIndex}
                onDeleteClick={target && target.costumes && target.costumes.length > 1 ?
                    this.handleDeleteCostume : null}
                onDrop={this.handleDrop}
                onDuplicateClick={this.handleDuplicateCostume}
                onExportClick={this.handleExportCostume}
                onClearSelection={this.handleClearSelection}
                onDeleteSelected={this.handleDeleteSelected}
                onDuplicateSelected={this.handleDuplicateSelected}
                onExportSelected={this.handleExportSelected}
                onItemClick={this.handleSelectCostume}
                onMoveToFolder={this.handleMoveToFolder}
                onToggleFolder={this.handleToggleFolder}
            >
                {target.costumes ?
                    <PaintEditorWrapper
                        selectedCostumeIndex={this.state.selectedCostumeIndex}
                    /> :
                    null
                }
            </AssetPanel>
        );
    }
}

CostumeTab.propTypes = {
    dispatchUpdateRestore: PropTypes.func,
    editingTarget: PropTypes.string,
    intl: intlShape,
    isRtl: PropTypes.bool,
    onActivateSoundsTab: PropTypes.func.isRequired,
    onCloseImporting: PropTypes.func.isRequired,
    onNewLibraryBackdropClick: PropTypes.func.isRequired,
    onNewLibraryCostumeClick: PropTypes.func.isRequired,
    onShowImporting: PropTypes.func.isRequired,
    sprites: PropTypes.shape({
        id: PropTypes.shape({
            costumes: PropTypes.arrayOf(PropTypes.shape({
                url: PropTypes.string,
                name: PropTypes.string.isRequired,
                skinId: PropTypes.number
            }))
        })
    }),
    stage: PropTypes.shape({
        sounds: PropTypes.arrayOf(PropTypes.shape({
            name: PropTypes.string.isRequired
        }))
    }),
    vm: PropTypes.instanceOf(VM)
};

const mapStateToProps = state => ({
    editingTarget: state.scratchGui.targets.editingTarget,
    isRtl: state.locales.isRtl,
    sprites: state.scratchGui.targets.sprites,
    stage: state.scratchGui.targets.stage,
    dragging: state.scratchGui.assetDrag.dragging
});

const mapDispatchToProps = dispatch => ({
    onActivateSoundsTab: () => dispatch(activateTab(SOUNDS_TAB_INDEX)),
    onNewLibraryBackdropClick: e => {
        e.preventDefault();
        dispatch(openBackdropLibrary());
    },
    onNewLibraryCostumeClick: e => {
        e.preventDefault();
        dispatch(openCostumeLibrary());
    },
    dispatchUpdateRestore: restoreState => {
        dispatch(setRestore(restoreState));
    },
    onCloseImporting: () => dispatch(closeAlertWithId('importingAsset')),
    onShowImporting: () => dispatch(showStandardAlert('importingAsset'))
});

export default errorBoundaryHOC('Costume Tab')(
    injectIntl(connect(
        mapStateToProps,
        mapDispatchToProps
    )(CostumeTab))
);
