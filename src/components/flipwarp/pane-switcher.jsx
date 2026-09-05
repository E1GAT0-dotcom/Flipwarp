import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';

import {
    BLOCKS_TAB_INDEX,
    COSTUMES_TAB_INDEX,
    SOUNDS_TAB_INDEX
} from '../../reducers/editor-tab.js';
import styles from './pane-switcher.css';

const CODE = 'code';
const STAGE = 'stage';

// What to call the editor half, which is whichever of the three tabs is open.
// Calling it "Blocks" while someone is drawing a costume is a lie about where
// they are, and the highlight makes it a confident one.
const TAB_NAMES = {
    [BLOCKS_TAB_INDEX]: 'Blocks',
    [COSTUMES_TAB_INDEX]: 'Costumes',
    [SOUNDS_TAB_INDEX]: 'Sounds'
};

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
 * The run buttons belong here too — running a project you are in the middle of
 * writing should not mean swapping pane, pressing go, and swapping back. They
 * are not drawn here though: the strip above the stage that already holds the
 * green flag, stop, pause and the radio is pinned into this bar by the
 * stylesheet instead. Drawing a second green flag would mean two of everything
 * in the page, and the pause button — which is added by an addon, to whichever
 * strip it finds first — would attach to the wrong one.
 */
class PaneSwitcher extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleShowCode', 'handleShowStage', 'handleResize']);
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
                {/* The run controls are pinned in from above the stage by the
                    stylesheet; this is the room left for them. */}
                <div className={styles.panes}>
                    <button
                        className={`${styles.pane} ${pane === CODE ? styles.current : ''}`}
                        onClick={this.handleShowCode}
                    >{TAB_NAMES[this.props.activeTabIndex] || TAB_NAMES[BLOCKS_TAB_INDEX]}</button>
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
    activeTabIndex: PropTypes.number
};

const mapStateToProps = state => ({
    activeTabIndex: state.scratchGui.editorTab.activeTabIndex
});

export default connect(mapStateToProps)(PaneSwitcher);
