import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import SpriteSelectorItem from '../../containers/sprite-selector-item.jsx';
import Box from '../box/box.jsx';
import ActionMenu from '../action-menu/action-menu.jsx';
import SortableAsset from './sortable-asset.jsx';
import SortableHOC from '../../lib/sortable-hoc.jsx';
import DragConstants from '../../lib/drag-constants';

import styles from './selector.css';

const Selector = props => {
    const {
        buttons,
        containerRef,
        dragType,
        isRtl,
        items,
        selectedItemIndex,
        selectedIndices,
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
            {many ? (
                <Box className={styles.batchBar}>
                    <span className={styles.batchCount}>{`${chosen.length} selected`}</span>
                    <button
                        className={styles.batchButton}
                        title="Duplicate all of them"
                        onClick={onDuplicateSelected}
                    >{'Duplicate'}</button>
                    <button
                        className={styles.batchButton}
                        title="Save all of them to your computer"
                        onClick={onExportSelected}
                    >{'Export'}</button>
                    <button
                        className={classNames(styles.batchButton, styles.batchDelete)}
                        title="Delete all of them"
                        onClick={onDeleteSelected}
                    >{'Delete'}</button>
                    <button
                        className={styles.batchButton}
                        title="Stop selecting several"
                        onClick={onClearSelection}
                    >{'Cancel'}</button>
                </Box>
            ) : null}
            <Box className={styles.listArea}>
                {items.map((item, index) => (
                    <SortableAsset
                        id={item.name}
                        index={isRelevantDrag ? ordering.indexOf(index) : index}
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
