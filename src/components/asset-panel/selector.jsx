import PropTypes from 'prop-types';
import React, {useState} from 'react';
import classNames from 'classnames';
import SpriteSelectorItem from '../../containers/sprite-selector-item.jsx';
import Box from '../box/box.jsx';
import ActionMenu from '../action-menu/action-menu.jsx';
import SortableAsset from './sortable-asset.jsx';
import SortableHOC from '../../lib/sortable-hoc.jsx';
import DragConstants from '../../lib/drag-constants';

import styles from './selector.css';

// The strip that appears while costumes are picked out. A folder is named
// here rather than in a dialog box: a box would take the focus away from the
// list you are looking at, and typing a name is the whole interaction.
const SelectionBar = ({count, folders, onMove, onDuplicate, onExport, onDelete, onCancel}) => {
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');
    const many = count > 1;

    if (naming) {
        const move = () => {
            onMove(name);
            setNaming(false);
            setName('');
        };
        return (
            <Box className={styles.batchBar}>
                <input
                    autoFocus
                    className={styles.folderInput}
                    list="flipwarp-folders"
                    placeholder="Folder name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') move();
                        if (e.key === 'Escape') setNaming(false);
                    }}
                />
                <datalist id="flipwarp-folders">
                    {(folders || []).map(f => <option key={f} value={f} />)}
                </datalist>
                <button
                    className={styles.batchButton}
                    onClick={move}
                >{'Move'}</button>
                <button
                    className={styles.batchButton}
                    title="Take them out of any folder"
                    onClick={() => {
                        onMove('');
                        setNaming(false);
                    }}
                >{'None'}</button>
                <button
                    className={styles.batchButton}
                    onClick={() => setNaming(false)}
                >{'Cancel'}</button>
            </Box>
        );
    }

    return (
        <Box className={styles.batchBar}>
            {many ? <span className={styles.batchCount}>{`${count} selected`}</span> : null}
            <button
                className={styles.batchButton}
                title="Put these in a folder"
                onClick={() => setNaming(true)}
            >{'Folder…'}</button>
            {many ? (
                <React.Fragment>
                    <button
                        className={styles.batchButton}
                        title="Duplicate all of them"
                        onClick={onDuplicate}
                    >{'Duplicate'}</button>
                    <button
                        className={styles.batchButton}
                        title="Save all of them to your computer"
                        onClick={onExport}
                    >{'Export'}</button>
                    <button
                        className={classNames(styles.batchButton, styles.batchDelete)}
                        title="Delete all of them"
                        onClick={onDelete}
                    >{'Delete'}</button>
                    <button
                        className={styles.batchButton}
                        title="Stop selecting several"
                        onClick={onCancel}
                    >{'Cancel'}</button>
                </React.Fragment>
            ) : null}
        </Box>
    );
};

SelectionBar.propTypes = {
    count: PropTypes.number,
    folders: PropTypes.arrayOf(PropTypes.string),
    onCancel: PropTypes.func,
    onDelete: PropTypes.func,
    onDuplicate: PropTypes.func,
    onExport: PropTypes.func,
    onMove: PropTypes.func
};

const Selector = props => {
    const {
        buttons,
        containerRef,
        dragType,
        isRtl,
        items,
        selectedItemIndex,
        selectedIndices,
        displayOrder,
        folderHeaders,
        hiddenIndices,
        onToggleFolder,
        onMoveToFolder,
        folders,
        onClearSelection,
        onDeleteSelected,
        onDuplicateSelected,
        onExportSelected,
        draggingIndex,
        draggingType,
        ordering,
        onAddSortable,
        onRemoveSortable,
        onDeleteClick,
        onDuplicateClick,
        onExportClick,
        onItemClick
    } = props;

    const isRelevantDrag = draggingType === dragType;
    // More than one picked out means the buttons act on all of them, so a
    // strip appears saying so. One is the ordinary case and needs no strip:
    // the one you clicked is the one you are editing.
    const chosen = selectedIndices || [];
    const many = chosen.length > 1;
    // Folders are shown by reordering the list with CSS rather than by
    // reordering the costumes themselves. A costume's number is its place in
    // the sprite, and everything that acts on one — deleting it, switching to
    // it, dragging it — needs that number to stay true.
    const order = displayOrder || null;
    const hidden = hiddenIndices || [];

    let newButtonSection = null;

    if (buttons.length > 0) {
        const {img, title, onClick} = buttons[0];
        const moreButtons = buttons.slice(1);
        newButtonSection = (
            <Box className={styles.newButtons}>
                <ActionMenu
                    img={img}
                    moreButtons={moreButtons}
                    title={title}
                    tooltipPlace={isRtl ? 'left' : 'right'}
                    onClick={onClick}
                />
            </Box>
        );
    }

    return (
        <Box
            className={styles.wrapper}
            componentRef={containerRef}
        >
            {onMoveToFolder && chosen.length ? (
                <SelectionBar
                    count={chosen.length}
                    folders={folders}
                    onCancel={onClearSelection}
                    onDelete={onDeleteSelected}
                    onDuplicate={onDuplicateSelected}
                    onExport={onExportSelected}
                    onMove={onMoveToFolder}
                />
            ) : null}
            <Box className={styles.listArea}>
                {(folderHeaders || []).map(header => (
                    <div
                        className={styles.folderHeader}
                        key={`folder-${header.name}`}
                        style={{order: header.position}}
                        title={header.collapsed ? 'Show what is in here' : 'Hide what is in here'}
                        onClick={() => onToggleFolder && onToggleFolder(header.name)}
                    >
                        <span className={styles.folderArrow}>{header.collapsed ? '▸' : '▾'}</span>
                        <span className={styles.folderName}>{header.name}</span>
                        <span className={styles.folderCount}>{header.count}</span>
                    </div>
                ))}
                {items.map((item, index) => (
                    <SortableAsset
                        className={hidden.includes(index) ? styles.tucked : null}
                        id={item.name}
                        index={isRelevantDrag ? ordering.indexOf(index) :
                            (order ? order[index] : index)}
                        key={item.name}
                        onAddSortable={onAddSortable}
                        onRemoveSortable={onRemoveSortable}
                    >
                        <SpriteSelectorItem
                            asset={item.asset}
                            className={classNames(styles.listItem, {
                                [styles.placeholder]: isRelevantDrag && index === draggingIndex
                            })}
                            costumeURL={item.url}
                            details={item.details}
                            dragPayload={item.dragPayload}
                            dragType={dragType}
                            id={index}
                            index={index}
                            name={item.name}
                            number={index + 1 /* 1-indexed */}
                            selected={many ? chosen.includes(index) : index === selectedItemIndex}
                            onClick={onItemClick}
                            onDeleteButtonClick={onDeleteClick}
                            onDuplicateButtonClick={onDuplicateClick}
                            onExportButtonClick={onExportClick}
                        />
                    </SortableAsset>
                ))}
            </Box>
            {newButtonSection}
        </Box>
    );
};

Selector.propTypes = {
    buttons: PropTypes.arrayOf(PropTypes.shape({
        title: PropTypes.string.isRequired,
        img: PropTypes.string.isRequired,
        onClick: PropTypes.func
    })),
    containerRef: PropTypes.func,
    dragType: PropTypes.oneOf(Object.keys(DragConstants)),
    draggingIndex: PropTypes.number,
    draggingType: PropTypes.oneOf(Object.keys(DragConstants)),
    isRtl: PropTypes.bool,
    items: PropTypes.arrayOf(PropTypes.shape({
        url: PropTypes.string,
        name: PropTypes.any // modified by folders addon
    })),
    onAddSortable: PropTypes.func,
    onDeleteClick: PropTypes.func,
    onDuplicateClick: PropTypes.func,
    onExportClick: PropTypes.func,
    onItemClick: PropTypes.func.isRequired,
    displayOrder: PropTypes.arrayOf(PropTypes.number),
    folderHeaders: PropTypes.arrayOf(PropTypes.shape({
        name: PropTypes.string,
        position: PropTypes.number,
        count: PropTypes.number,
        collapsed: PropTypes.bool
    })),
    hiddenIndices: PropTypes.arrayOf(PropTypes.number),
    folders: PropTypes.arrayOf(PropTypes.string),
    onMoveToFolder: PropTypes.func,
    onToggleFolder: PropTypes.func,
    onClearSelection: PropTypes.func,
    onDeleteSelected: PropTypes.func,
    onDuplicateSelected: PropTypes.func,
    onExportSelected: PropTypes.func,
    onRemoveSortable: PropTypes.func,
    ordering: PropTypes.arrayOf(PropTypes.number),
    selectedIndices: PropTypes.arrayOf(PropTypes.number),
    selectedItemIndex: PropTypes.number.isRequired
};

export default SortableHOC(Selector);
