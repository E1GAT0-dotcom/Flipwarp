// "Export as code" in the editor: the project open in the VM, exported by package.js.
import runtimeSource from '!raw-loader!./web-runtime.js';
import {buildExport, TARGETS} from './package.js';

export {TARGETS};

/**
 * Export the project open in the VM.
 * @param {object} vm the VM
 * @param {string} target a key of TARGETS
 * @param {string} title the project's name
 * @returns {{files: Array<[string, Uint8Array]>, notes: Array, folder: string}} the export
 */
export const exportProject = (vm, target, title) => buildExport(vm.saveProjectSb3DontZip(), target, title,
    runtimeSource);
