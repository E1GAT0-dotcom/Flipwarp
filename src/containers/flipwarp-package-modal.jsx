import {connect} from 'react-redux';
import PackageModalComponent from '../components/flipwarp/package-modal.jsx';
import {closePackageModal} from '../reducers/modals';

const mapStateToProps = state => ({
    vm: state.scratchGui.vm,
    projectTitle: state.scratchGui.projectTitle
});

const mapDispatchToProps = dispatch => ({
    onClose: () => dispatch(closePackageModal())
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(PackageModalComponent);
