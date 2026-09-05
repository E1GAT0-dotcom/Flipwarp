import React from 'react';
import PropTypes from 'prop-types';
import ToolSelectComponent from '../tool-select-base/tool-select-base.jsx';
import messages from '../../lib/messages.js';
import wandIcon from './wand.svg';

const BitWandComponent = props => (
    <ToolSelectComponent
        imgDescriptor={messages.wand}
        imgSrc={wandIcon}
        isSelected={props.isSelected}
        onMouseDown={props.onMouseDown}
        keybinding="W"
    />
);

BitWandComponent.propTypes = {
    isSelected: PropTypes.bool.isRequired,
    onMouseDown: PropTypes.func.isRequired
};

export default BitWandComponent;
