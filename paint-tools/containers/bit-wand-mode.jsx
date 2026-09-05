import paper from '@turbowarp/paper';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import bindAll from 'lodash.bindall';
import Modes from '../lib/modes';

import {clearFillGradient} from '../reducers/fill-style';
import {changeMode} from '../reducers/modes';
import {clearSelectedItems, setSelectedItems} from '../reducers/selected-items';
import {setCursor} from '../reducers/cursor';

import {getSelectedLeafItems} from '../helper/selection';
import WandTool from '../helper/bit-tools/wand-tool';
import WandModeComponent from '../components/bit-wand-mode/bit-wand-mode.jsx';

class BitWandMode extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'activateTool',
            'deactivateTool'
        ]);
        // Read through a function rather than handed over once: the tool is
        // built when the mode is chosen and lives until it is left, so a
        // tolerance handed in at that moment would be the tolerance forever.
        this.readTolerance = () => this.props.tolerance;
        this.readContiguous = () => this.props.contiguous;
    }
    componentDidMount () {
        if (this.props.isWandModeActive) {
            this.activateTool(this.props);
        }
    }
    componentWillReceiveProps (nextProps) {
        if (this.tool && nextProps.selectedItems !== this.props.selectedItems) {
            this.tool.onSelectionChanged(nextProps.selectedItems);
        }

        if (nextProps.isWandModeActive && !this.props.isWandModeActive) {
            this.activateTool();
        } else if (!nextProps.isWandModeActive && this.props.isWandModeActive) {
            this.deactivateTool();
        }
    }
    shouldComponentUpdate (nextProps) {
        return nextProps.isWandModeActive !== this.props.isWandModeActive;
    }
    componentWillUnmount () {
        if (this.tool) {
            this.deactivateTool();
        }
    }
    activateTool () {
        this.props.clearGradient();
        this.tool = new WandTool(
            this.props.setSelectedItems,
            this.props.clearSelectedItems,
            this.props.setCursor,
            this.props.onUpdateImage,
            this.readTolerance,
            this.readContiguous
        );
        this.tool.activate();
    }
    deactivateTool () {
        this.tool.deactivateTool();
        this.tool.remove();
        this.tool = null;
    }
    render () {
        return (
            <WandModeComponent
                isSelected={this.props.isWandModeActive}
                onMouseDown={this.props.handleMouseDown}
            />
        );
    }
}

BitWandMode.propTypes = {
    clearGradient: PropTypes.func.isRequired,
    clearSelectedItems: PropTypes.func.isRequired,
    contiguous: PropTypes.bool.isRequired,
    handleMouseDown: PropTypes.func.isRequired,
    isWandModeActive: PropTypes.bool.isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    selectedItems: PropTypes.arrayOf(PropTypes.instanceOf(paper.Item)),
    setCursor: PropTypes.func.isRequired,
    setSelectedItems: PropTypes.func.isRequired,
    tolerance: PropTypes.number.isRequired
};

const mapStateToProps = state => ({
    isWandModeActive: state.scratchPaint.mode === Modes.BIT_WAND,
    selectedItems: state.scratchPaint.selectedItems,
    tolerance: state.scratchPaint.wandMode.tolerance,
    contiguous: state.scratchPaint.wandMode.contiguous
});
const mapDispatchToProps = dispatch => ({
    clearGradient: () => {
        dispatch(clearFillGradient());
    },
    clearSelectedItems: () => {
        dispatch(clearSelectedItems());
    },
    setCursor: cursorType => {
        dispatch(setCursor(cursorType));
    },
    setSelectedItems: () => {
        dispatch(setSelectedItems(getSelectedLeafItems()));
    },
    handleMouseDown: () => {
        dispatch(changeMode(Modes.BIT_WAND));
    }
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(BitWandMode);
