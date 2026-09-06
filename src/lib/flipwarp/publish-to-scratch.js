// Getting a project onto Scratch with as little clicking as the web allows.
//
// The first thing to say is why this is not one button. Being logged in to
// Scratch means the browser is holding a cookie that belongs to
// scratch.mit.edu, and it will not hand that cookie to a page served from
// anywhere else. Even if it did, Scratch answers requests from other sites
// with a header naming who may read the reply, and that list is Scratch's own
// pages. Three fences, all doing exactly the job they were built for: they are
// what stops any site you happen to visit from posting to your account while
// you are signed in. Nothing written here can climb them, and nothing should.
//
// So the work is split at the fence.
//
// On this side: the project file, and the words that go with it. Flipwarp
// saves the .sb3 and puts the title and the notes on the clipboard.
//
// On the other side: a bookmarklet, which is a bookmark whose address is a
// small program. Pressed while you are on a Scratch page it is running inside
// Scratch, with the cookie the browser was always willing to give that page,
// so it can do the whole thing: open the file, send every costume and sound,
// send the project, set the title and the notes, and share it.
//
// It asks before making a new project rather than before writing over one,
// which is the other way round from what you might expect. Writing over a
// project you named is the ordinary thing to do and you said which one.
// Making new ones is the thing that goes wrong at scale: people who have
// automated this before have found that making a lot of them quickly gets
// accounts banned, so that is the door with a handle on it.

import {BOOKMARKLET_SOURCE} from './bookmarklet-source.js';

const REMEMBERED = 'flipwarp:scratch-projects';

/**
 * What a project was published as last time, if it was.
 * @param {string} title the project's title in Flipwarp
 * @returns {string} a Scratch project id, or an empty string
 */
export const rememberedId = title => {
    try {
        const all = JSON.parse(localStorage.getItem(REMEMBERED) || '{}');
        const found = all[String(title)];
        return typeof found === 'string' ? found : '';
    } catch (e) {
        return '';
    }
};

/**
 * Remember which Scratch project this one became.
 * @param {string} title the project's title in Flipwarp
 * @param {string} id the Scratch project id, or empty to forget it
 */
export const rememberId = (title, id) => {
    try {
        const all = JSON.parse(localStorage.getItem(REMEMBERED) || '{}');
        if (id) all[String(title)] = String(id);
        else delete all[String(title)];
        localStorage.setItem(REMEMBERED, JSON.stringify(all));
    } catch (e) {
        // A browser that refuses storage still publishes; it just cannot
        // offer to overwrite the same project next time.
    }
};

// A Scratch project id is a number in the address. People paste the whole
// address as often as the number, so both are accepted.
export const idFrom = text => {
    const match = /(\d{4,})/.exec(String(text || ''));
    return match ? match[1] : '';
};

/**
 * The project as a file, ready to be loaded into Scratch's editor.
 * @param {object} vm the VM
 * @param {string} title what to call the file
 * @returns {Promise<{name: string, url: string}>} the file and its address
 */
export const projectFile = async (vm, title) => {
    const data = await vm.saveProjectSb3('arraybuffer');
    const tidy = String(title || 'project')
        .replace(/[\\/:*?"<>|]/g, '-')
        .slice(0, 80);
    const name = `${tidy || 'project'}.sb3`;
    return {name, url: URL.createObjectURL(new Blob([data], {type: 'application/octet-stream'}))};
};

/**
 * What the bookmarklet needs to know, small enough to sit on a clipboard.
 * @param {object} what the title, notes and whether to share
 * @returns {string} the ticket
 */
export const ticketFor = ({title, instructions, share, id}) => JSON.stringify({
    flipwarp: 1,
    title: String(title || ''),
    instructions: String(instructions || ''),
    share: Boolean(share),
    // The project to write over. Empty means make a new one, which the
    // bookmarklet asks about before doing.
    id: idFrom(id)
});

// Where Scratch's editor opens a new, empty project.
export const NEW_PROJECT = 'https://scratch.mit.edu/projects/editor/';

/**
 * The address of an existing project's editor.
 * @param {string} id the Scratch project id
 * @returns {string} the address
 */
export const editorFor = id => `https://scratch.mit.edu/projects/${idFrom(id)}/editor/`;

/**
 * The bookmarklet, as the single line a bookmark's address has to be.
 * @returns {string} the address
 */
export const bookmarklet = () => `javascript:${encodeURIComponent(BOOKMARKLET_SOURCE)}`;
