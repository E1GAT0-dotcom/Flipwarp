import VM from 'scratch-vm';
import {installPenguinModCompat} from '../lib/flipwarp/penguinmod-compat.js';
import {installLoadingAssets} from '../lib/flipwarp/loading-assets.js';
import storage from '../lib/storage';
import {MAXIMUM_CLOUD_VARIABLES} from '../lib/tw-cloud-limits';

const SET_VM = 'scratch-gui/vm/SET_VM';
const defaultVM = new VM();
// Extensions written for PenguinMod expect a few hooks this engine does not
// have. Adding them here means an extension is fixed once, for everyone,
// rather than forked and left to go stale.
installPenguinModCompat(defaultVM);
// So the loading screen can say what it is loading, not just how many.
installLoadingAssets(defaultVM);
defaultVM.setCompatibilityMode(true);
defaultVM.runtime.cloudOptions.limit = MAXIMUM_CLOUD_VARIABLES;
defaultVM.attachStorage(storage);
const initialState = defaultVM;

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case SET_VM:
        return action.vm;
    default:
        return state;
    }
};
const setVM = function (vm) {
    return {
        type: SET_VM,
        vm: vm
    };
};

export {
    reducer as default,
    initialState as vmInitialState,
    setVM
};
