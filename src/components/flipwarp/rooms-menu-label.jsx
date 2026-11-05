import PropTypes from 'prop-types';
import React from 'react';

import rooms from '../../lib/flipwarp/rooms.js';

/**
 * Shows the room's code in the menu bar while one is open, so it can be read
 * out without opening the dialog.
 */
class RoomsMenuLabel extends React.Component {
    constructor (props) {
        super(props);
        this.state = {room: rooms.state};
    }
    componentDidMount () {
        this.unsubscribe = rooms.subscribe(room => this.setState({room}));
    }
    componentWillUnmount () {
        this.unsubscribe();
    }
    render () {
        const {room} = this.state;
        if (room.status === 'hosting' || room.status === 'joined') {
            return `Room ${room.code} (${room.players.length})`;
        }
        if (room.status === 'joining' || room.status === 'starting') return 'Connecting...';
        return this.props.children;
    }
}

RoomsMenuLabel.propTypes = {
    children: PropTypes.node
};

export default RoomsMenuLabel;
