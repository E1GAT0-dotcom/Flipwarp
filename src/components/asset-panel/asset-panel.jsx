import bindAll from 'lodash.bindall';
import React from 'react';

import Box from '../box/box.jsx';
import Selector from './selector.jsx';
import styles from './asset-panel.css';

/**
 * The costume and sound tabs: the list down one side, the editor beside it.
 *
 * The list is 150 points wide, which is a third of a phone screen and leaves
 * the paint editor too narrow to draw in. So on a phone there is a handle
 * between the two that folds the list away, and the editor takes the room.
 *
 * The handle sits on the join rather than inside either half, so it is in the
 * same place whether the list is open or shut — a button that moves when you
 * press it is a button you have to look for twice.
 *
 * Whether it is folded is remembered on the page rather than here, so it
 * survives switching between costumes and sounds, which throws this component
 * away and builds another one.
 */
class AssetPanel extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleToggle']);
        this.state = {shut: document.documentElement.dataset.assets === 'shut'};
    }
    handleToggle () {
        const shut = !this.state.shut;
        if (shut) document.documentElement.dataset.assets = 'shut';
        else delete document.documentElement.dataset.assets;
        this.setState({shut});
        // The paint editor measures itself against the space it has, and it
        // has just been given more of it.
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
    render () {
        const {shut} = this.state;
        return (
            <Box className={styles.wrapper}>
                <Selector
                    className={styles.selector}
                    {...this.props}
                />
                <button
                    aria-label={shut ? 'Show the list' : 'Hide the list'}
                    className={styles.handle}
                    title={shut ? 'Show the list' : 'Hide the list'}
                    onClick={this.handleToggle}
                >{shut ? '›' : '‹'}</button>
                <Box className={styles.detailArea}>
                    {this.props.children}
                </Box>
            </Box>
        );
    }
}

AssetPanel.propTypes = {
    ...Selector.propTypes
};

export default AssetPanel;
