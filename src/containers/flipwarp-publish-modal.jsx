import {connect} from 'react-redux';
import PublishModalComponent from '../components/flipwarp/publish-modal.jsx';
import {closePublishModal} from '../reducers/modals';

const mapStateToProps = state => ({
    vm: state.scratchGui.vm,
    projectTitle: state.scratchGui.projectTitle
});

const mapDispatchToProps = dispatch => ({
    onClose: () => dispatch(closePublishModal())
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(PublishModalComponent);
