import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';

/**
 * Draw whatever is inside again when the window changes size.
 *
 * The stage works out how big it should be from the width of the window, which
 * is fine the first time and never again: React has no reason to think
 * anything changed, so turning a phone sideways left the stage the size it was
 * in the other orientation. This exists only to give it a reason.
 *
 * Held off until the next frame, because a drag of a window edge is a hundred
 * resize events and there is no sense drawing a hundred times.
 */
class FitToWindow extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleResize']);
        this.pending = 0;
        this.state = {at: 0};
    }
    componentDidMount () {
        window.addEventListener('resize', this.handleResize);
        window.addEventListener('orientationchange', this.handleResize);
    }
    componentWillUnmount () {
        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('orientationchange', this.handleResize);
        cancelAnimationFrame(this.pending);
    }
    handleResize () {
        cancelAnimationFrame(this.pending);
        this.pending = requestAnimationFrame(() => {
            this.setState({at: Date.now()});
        });
    }
    render () {
        return this.props.children;
    }
}

FitToWindow.propTypes = {
    children: PropTypes.node
};

export default FitToWindow;
