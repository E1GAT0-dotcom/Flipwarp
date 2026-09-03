// Names for the things a project is loading.
//
// The engine counts asset requests but never says what any of them are: the
// loading screen can tell you it is on 12 of 40 and nothing more. It knows,
// of course — a costume has a name, and it belongs to a sprite — but that
// name is inside a closure by the time the request is made, out of reach.
//
// So this reads the project's own description of itself before the engine
// starts, and lays the assets out in the order the engine asks for them:
// targets in layer order, and within each one its costumes and then its
// sounds. The engine's Nth request is then the Nth thing on that list.
//
// If any of that fails — an unfamiliar file, an older project format — the
// list is simply empty and the loading screen shows its counts as before.
// Nothing here is allowed to stop a project from opening.

export const FLIPWARP_ASSET = 'FLIPWARP_ASSET';

const readProjectJson = async input => {
    if (!input) return null;

    if (typeof input === 'object' && !ArrayBuffer.isView(input) && !(input instanceof ArrayBuffer)) {
        // Already the project itself.
        return input;
    }

    if (typeof input === 'string') {
        try {
            return JSON.parse(input);
        } catch (e) {
            return null;
        }
    }

    // An .sb3 is a zip with project.json inside it.
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    if (!bytes || typeof bytes.length !== 'number') return null;
    // "PK" — anything else is not a zip and there is nothing to unpack.
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        try {
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            return null;
        }
    }

    try {
        const {default: JSZip} = await import(/* webpackChunkName: "jszip" */ 'jszip');
        const zip = await JSZip.loadAsync(bytes);
        const file = zip.file('project.json');
        if (!file) return null;
        return JSON.parse(await file.async('string'));
    } catch (e) {
        return null;
    }
};

/**
 * Flatten a project into the order its assets are requested in.
 * @param {object} json the project
 * @returns {Array} one entry per asset, in request order
 */
export const assetOrder = json => {
    if (!json) return [];
    const targets = json.targets || (json.costumes ? [json] : []);
    if (!Array.isArray(targets)) return [];

    // The engine sorts targets by layer order before touching their assets,
    // so this has to sort them the same way or every name would be off by a
    // sprite. Sorting a copy — the engine wants the original order too.
    const inOrder = targets
        .map((target, index) => ({target, index}))
        .sort((a, b) => {
            const av = typeof a.target.layerOrder === 'number' ? a.target.layerOrder : a.index;
            const bv = typeof b.target.layerOrder === 'number' ? b.target.layerOrder : b.index;
            return av - bv;
        })
        .map(entry => entry.target);

    const list = [];
    for (const target of inOrder) {
        const sprite = target.isStage ? 'Stage' : (target.name || '');
        for (const costume of target.costumes || []) {
            list.push({sprite, name: costume.name || '', kind: 'costume'});
        }
        for (const sound of target.sounds || []) {
            list.push({sprite, name: sound.name || '', kind: 'sound'});
        }
    }
    return list;
};

/**
 * Report which asset is in flight while a project loads.
 * @param {VirtualMachine} vm the VM to watch
 */
export const installLoadingAssets = vm => {
    if (!vm || !vm.runtime || vm.runtime.__flipwarpLoadingInstalled) return;
    vm.runtime.__flipwarpLoadingInstalled = true;

    let order = [];
    let started = 0;
    const finished = new Set();

    // Reported as each request settles, naming the asset that request was
    // for. The alternative — naming the first one still outstanding — sounds
    // more like "currently loading", but every request is made at once, so on
    // anything fast the pointer runs past whole categories before the first
    // one is announced: a project would load twenty-two things and name only
    // its sounds. Naming what just arrived means every asset gets said.
    const announce = index => {
        const asset = order[index];
        if (!asset) return;
        try {
            vm.emit(FLIPWARP_ASSET, {
                sprite: asset.sprite,
                name: asset.name,
                kind: asset.kind,
                done: finished.size,
                total: order.length
            });
        } catch (e) {
            // The loading screen throwing must not stop the project loading.
        }
    };

    const originalLoadProject = vm.loadProject.bind(vm);
    vm.loadProject = async input => {
        order = [];
        started = 0;
        finished.clear();
        try {
            order = assetOrder(await readProjectJson(input));
        } catch (e) {
            order = [];
        }
        return originalLoadProject(input);
    };

    const runtime = vm.runtime;
    const originalWrap = runtime.wrapAssetRequest;
    if (typeof originalWrap !== 'function') return;
    runtime.wrapAssetRequest = function flipwarpWrapAssetRequest (callback) {
        const index = started++;
        const promise = originalWrap.call(this, callback);
        const settled = () => {
            finished.add(index);
            announce(index);
        };
        promise.then(settled, settled);
        return promise;
    };
};
