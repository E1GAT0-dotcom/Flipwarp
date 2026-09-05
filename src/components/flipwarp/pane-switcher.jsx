import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';

import GreenFlag from '../green-flag/green-flag.jsx';
import StopAll from '../stop-all/stop-all.jsx';
import styles from './pane-switcher.css';

const CODE = 'code';
const STAGE = 'stage';

/**
 * The bar along the bottom of a phone.
 *
 * On anything wider the blocks and the stage sit side by side, which is the
 * whole shape of the editor. On a phone they cannot, so only one is on screen
 * at a time and this is what swaps them.
 *
 * The two panes are laid side by side at a screenful each and this scrolls the
 * row from one to the other. Scrolled rather than hidden on purpose: a hidden
 * stage has no size, and a renderer told it has no size stops drawing, so
 * coming back to it shows a blank white square. Scrolled, both are always laid
 * out and only the view moves.
 *
 * Which one is showing is also written on the <html> element, for rules
 * elsewhere that want to know. The stylesheet is what decides this bar exists
 * at all — it is hidden unless the screen is narrow and a finger is what was
 * last used — so nothing here has to measure the window.
 *
 * The run buttons are here as well, and they are the reason the bar is worth
 * having rather than a plain pair of tabs. Green flag and stop live above the
 * stage, so without them here, running a project you are in the middle of
 * writing would mean swapping pane, pressing go, and swapping back.
 */
class PaneSwitcher extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleShowCode', 'handleShowStage', 'handleResize', 'handleGo', 'handleStop']);
        this.state = {pane: CODE};
    }
    componentDidMount () {
        this.show(this.state.pane);
        // Turning the phone sideways changes what a screenful is, and the row
        // stays scrolled to the old number of pixels.
        window.addEventListener('resize', this.handleResize);
    }
    componentWillUnmount () {
        window.removeEventListener('resize', this.handleResize);
        delete document.documentElement.dataset.pane;
    }
    handleGo () {
        // The same two steps the controls above the stage take: a project that
        // has never been started has to be started before the flag means
        // anything.
        if (!this.props.vm.runtime._steppingInterval) this.props.vm.start();
        this.props.vm.greenFlag();
    }
    handleStop () {
        this.props.vm.stopAll();
    }
    handleResize () {
        this.scrollTo(this.state.pane, 'auto');
    }
    scrollTo (pane, behavior) {
        const row = document.querySelector('[data-flipwarp-panes]');
        if (!row) return;
        row.scrollTo({left: pane === STAGE ? row.clientWidth : 0, behavior});
    }
    handleShowCode () {
        this.show(CODE);
    }
    handleShowStage () {
        this.show(STAGE);
    }
    show (pane) {
        document.documentElement.dataset.pane = pane;
        this.setState({pane});
        this.scrollTo(pane, 'smooth');
    }
    render () {
        const {pane} = this.state;
        return (
            <div className={styles.bar}>
                {/* The two buttons themselves rather than the whole control
                    strip: that also carries the radio, and a second radio
                    player in a hidden bar is a second radio player. */}
                <div className={styles.controls}>
                    <GreenFlag
                        title={'Go'}
                        onClick={this.handleGo}
                    />
                    <StopAll
                        title={'Stop'}
                        onClick={this.handleStop}
                    />
                </div>
                <div className={styles.panes}>
                    <button
                        className={`${styles.pane} ${pane === CODE ? styles.current : ''}`}
                        onClick={this.handleShowCode}
                    >{'Blocks'}</button>
                    <button
                        className={`${styles.pane} ${pane === STAGE ? styles.current : ''}`}
                        onClick={this.handleShowStage}
                    >{'Stage'}</button>
                </div>
            </div>
        );
    }
}

PaneSwitcher.propTypes = {
    vm: PropTypes.instanceOf(VM).isRequired
};

export default PaneSwitcher;
