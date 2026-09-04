// Folders for costumes.
//
// Scratch's save format has no idea of a folder. It keeps a costume's name,
// its picture, and where its centre is, and that is all — so anything that
// wants folders has to put them somewhere.
//
// The usual answer, and what the Folders addon does, is to hide the folder in
// the costume's name: "walk cycle//walk-1". It works, and it costs you the
// name. Every "switch costume to [walk-1]" in the project has to become
// "switch costume to [walk cycle//walk-1]", and renaming the folder breaks
// every one of them again. That is not a trade worth making.
//
// A fork can do better, because a fork controls what gets written. Folders go
// in a section of their own that Scratch does not read: the file stays a
// perfectly ordinary project, opens in Scratch exactly as it always did, and
// the costume is still called "walk-1". Opening it somewhere that is not
// Flipwarp simply shows a flat list, which is what it showed before.
//
//   {
//     "targets": [...],        <- untouched
//     "monitors": [...],
//     "extensions": [...],
//     "meta": {...},
//     "flipwarp": {            <- ignored by everything else
//       "folders": {"Sprite1": {"walk-1": "walk cycle"}}
//     }
//   }
//
// Costumes are keyed by name inside each sprite because that is the only
// thing about a costume that is both stable and unique within its sprite.

const KEY = 'flipwarp';

// Kept on the runtime costume itself while the editor is open. It is dropped
// when the project is saved — the serializer builds a fresh object with a
// fixed set of fields — which is exactly why it is written out separately.
const FIELD = 'flipwarpFolder';

/**
 * The folder a costume is in, or null for one that is not in any.
 * @param {object} costume a runtime costume
 * @returns {?string} the folder's name
 */
export const folderOf = costume => (costume && typeof costume[FIELD] === 'string' ?
    costume[FIELD] : null);

/**
 * Put a costume in a folder, or take it out of one.
 * @param {object} costume a runtime costume
 * @param {?string} folder the folder's name, or null to take it out
 */
export const setFolder = (costume, folder) => {
    if (!costume) return;
    const name = typeof folder === 'string' ? folder.trim() : '';
    if (name) costume[FIELD] = name;
    else delete costume[FIELD];
};

/**
 * Every folder in a sprite, in the order the costumes in them appear.
 * @param {Array} costumes the sprite's costumes
 * @returns {Array<string>} the folder names
 */
export const foldersIn = costumes => {
    const seen = [];
    for (const costume of costumes || []) {
        const folder = folderOf(costume);
        if (folder && !seen.includes(folder)) seen.push(folder);
    }
    return seen;
};

/**
 * The costume list as it should be shown: each folder's costumes gathered
 * together, in the order the folders first appear, and everything loose after
 * them.
 *
 * The numbers are the costume's real place in the sprite, not its place on
 * screen — everything that acts on a costume needs the real one.
 *
 * @param {Array} costumes the sprite's costumes
 * @returns {Array<{index: number, folder: ?string}>} the order to show
 */
export const groupedOrder = costumes => {
    const list = costumes || [];
    const rows = [];
    for (const folder of foldersIn(list)) {
        list.forEach((costume, index) => {
            if (folderOf(costume) === folder) rows.push({index, folder});
        });
    }
    list.forEach((costume, index) => {
        if (!folderOf(costume)) rows.push({index, folder: null});
    });
    return rows;
};

// ------------------------------------------------------- saving and loading

const foldersFromRuntime = runtime => {
    const out = {};
    for (const target of runtime.targets) {
        if (!target.isOriginal) continue;
        const mine = {};
        for (const costume of target.getCostumes()) {
            const folder = folderOf(costume);
            if (folder) mine[costume.name] = folder;
        }
        if (Object.keys(mine).length) out[target.getName()] = mine;
    }
    return out;
};

const applyToRuntime = (runtime, folders) => {
    if (!folders || typeof folders !== 'object') return;
    for (const target of runtime.targets) {
        if (!target.isOriginal) continue;
        const mine = folders[target.getName()];
        if (!mine || typeof mine !== 'object') continue;
        for (const costume of target.getCostumes()) {
            const folder = mine[costume.name];
            if (typeof folder === 'string') setFolder(costume, folder);
        }
    }
};

// Reading a project that came in as a zip means looking inside it for the
// project.json. Done with the zip library the VM already carries, so this
// adds nothing to the page.
const readFoldersFromInput = async input => {
    try {
        if (typeof input === 'string') {
            return (JSON.parse(input)[KEY] || {}).folders || null;
        }
        if (input && typeof input === 'object' && !(input instanceof ArrayBuffer) &&
            !ArrayBuffer.isView(input)) {
            return (input[KEY] || {}).folders || null;
        }
        const JSZip = (await import(/* webpackChunkName: "jszip" */ 'jszip')).default;
        const zip = await JSZip.loadAsync(input);
        const file = zip.file('project.json');
        if (!file) return null;
        return (JSON.parse(await file.async('string'))[KEY] || {}).folders || null;
    } catch (e) {
        // A project that cannot be read for folders still loads perfectly
        // well without them. This is never worth failing a load over.
        return null;
    }
};

let installed = false;

/**
 * Make folders survive saving and loading. Safe to call more than once.
 * @param {VirtualMachine} vm the running VM
 */
export const installCostumeFolders = vm => {
    if (installed || !vm) return;
    installed = true;

    // Everything that saves goes through toJSON — the .sb3 zip puts its
    // result in as project.json — so one place covers every way out.
    const originalToJSON = vm.toJSON.bind(vm);
    vm.toJSON = (...args) => {
        const json = originalToJSON(...args);
        try {
            const folders = foldersFromRuntime(vm.runtime);
            if (!Object.keys(folders).length) return json;
            const parsed = JSON.parse(json);
            parsed[KEY] = Object.assign({}, parsed[KEY], {folders});
            return JSON.stringify(parsed);
        } catch (e) {
            // Saving the project matters more than saving the folders.
            return json;
        }
    };

    const originalLoadProject = vm.loadProject.bind(vm);
    vm.loadProject = async input => {
        // Read before loading: the input is the only copy of the file, and
        // once it has been loaded the extra section is gone.
        const folders = await readFoldersFromInput(input);
        const result = await originalLoadProject(input);
        if (folders) applyToRuntime(vm.runtime, folders);
        return result;
    };
};
