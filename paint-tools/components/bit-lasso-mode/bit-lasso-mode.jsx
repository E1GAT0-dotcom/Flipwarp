import React from 'react';
import PropTypes from 'prop-types';
import ToolSelectComponent from '../tool-select-base/tool-select-base.jsx';
import messages from '../../lib/messages.js';
import lassoIcon from './lasso.svg';

const BitLassoComponent = props => (
    <ToolSelectComponent
        imgDescriptor={messages.lasso}
        imgSrc={lassoIcon}
        isSelected={props.isSelected}
        onMouseDown={props.onMouseDown}
        keybinding="Q"
    />
);

BitLassoComponent.propTypes = {
    isSelected: PropTypes.bool.isRequired,
    onMouseDown: PropTypes.func.isRequired
};

export default BitLassoComponent;
