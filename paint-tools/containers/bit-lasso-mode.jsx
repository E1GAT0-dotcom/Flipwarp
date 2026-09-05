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
import LassoTool from '../helper/bit-tools/lasso-tool';
import LassoModeComponent from '../components/bit-lasso-mode/bit-lasso-mode.jsx';

class BitLassoMode extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'activateTool',
            'deactivateTool'
        ]);
    }
    componentDidMount () {
        if (this.props.isLassoModeActive) {
            this.activateTool(this.props);
        }
    }
    componentWillReceiveProps (nextProps) {
        if (this.tool && nextProps.selectedItems !== this.props.selectedItems) {
            this.tool.onSelectionChanged(nextProps.selectedItems);
        }

        if (nextProps.isLassoModeActive && !this.props.isLassoModeActive) {
            this.activateTool();
        } else if (!nextProps.isLassoModeActive && this.props.isLassoModeActive) {
            this.deactivateTool();
        }
    }
    shouldComponentUpdate (nextProps) {
        return nextProps.isLassoModeActive !== this.props.isLassoModeActive;
    }
    componentWillUnmount () {
        if (this.tool) {
            this.deactivateTool();
        }
    }
    activateTool () {
        this.props.clearGradient();
        this.tool = new LassoTool(
            this.props.setSelectedItems,
            this.props.clearSelectedItems,
            this.props.setCursor,
            this.props.onUpdateImage
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
            <LassoModeComponent
                isSelected={this.props.isLassoModeActive}
                onMouseDown={this.props.handleMouseDown}
            />
        );
    }
}

BitLassoMode.propTypes = {
    clearGradient: PropTypes.func.isRequired,
    clearSelectedItems: PropTypes.func.isRequired,
    handleMouseDown: PropTypes.func.isRequired,
    isLassoModeActive: PropTypes.bool.isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    selectedItems: PropTypes.arrayOf(PropTypes.instanceOf(paper.Item)),
    setCursor: PropTypes.func.isRequired,
    setSelectedItems: PropTypes.func.isRequired
};

const mapStateToProps = state => ({
    isLassoModeActive: state.scratchPaint.mode === Modes.BIT_LASSO,
    selectedItems: state.scratchPaint.selectedItems
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
        dispatch(changeMode(Modes.BIT_LASSO));
    }
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(BitLassoMode);
