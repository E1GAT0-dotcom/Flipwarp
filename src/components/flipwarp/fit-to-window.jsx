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
        // Handing back the very same element is what this used to do, and it
        // did nothing at all: React compares the element it is given with the
        // one from last time, sees the same object, and skips the whole
        // subtree. The state above changed and nothing was drawn again, which
        // is the exact failure this component was written to prevent.
        //
        // Copying the element makes a new object with the same type and the
        // same key, so React updates what is already there rather than
        // building it again. Nothing is remounted: the stage keeps its canvas
        // and its renderer, and simply works out its size afresh.
        const only = React.Children.only(this.props.children);
        return React.isValidElement(only) ? React.cloneElement(only) : only;
    }
}

FitToWindow.propTypes = {
    children: PropTypes.node
};

export default FitToWindow;
