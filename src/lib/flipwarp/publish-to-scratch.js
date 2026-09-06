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
// and it can set the title and the notes and share the project. Those three
// are documented and are the ones it uses.
//
// What it deliberately does not do is upload the file. Creating a project and
// putting an .sb3 into it are not documented anywhere, and guessing at how to
// write to somebody's account is not a thing to do with somebody's account.
// Loading the file yourself is three clicks in Scratch's own editor, and it is
// the part that cannot break.

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
export const ticketFor = ({title, instructions, share}) => JSON.stringify({
    flipwarp: 1,
    title: String(title || ''),
    instructions: String(instructions || ''),
    share: Boolean(share)
});

// Where Scratch's editor opens a new, empty project.
export const NEW_PROJECT = 'https://scratch.mit.edu/projects/editor/';

/**
 * The address of an existing project's editor.
 * @param {string} id the Scratch project id
 * @returns {string} the address
 */
export const editorFor = id => `https://scratch.mit.edu/projects/${idFrom(id)}/editor/`;

// The bookmarklet.
//
// Written out here rather than kept in a file of its own because it has to be
// copied as one line into a bookmark, and because a bookmark cannot fetch it
// from Flipwarp: this site may not be reachable from wherever the browser is,
// and a bookmark that only works on one network is a bookmark that fails
// silently on the day you need it.
//
// It only ever touches the project whose page you are standing on, and only
// when you press it. Every call it makes is one Scratch documents.
const BOOKMARKLET_SOURCE = `(async function () {
  var say = function (m) { alert('Flipwarp: ' + m); };
  if (!location.hostname.endsWith('scratch.mit.edu')) {
    return say('Press this while you are on the Scratch page for your project.');
  }
  var id = (location.pathname.match(/projects\\/(\\d+)/) || [])[1];
  if (!id) return say('Open your project on Scratch first, so its number is in the address.');

  var ticket = null;
  try {
    ticket = JSON.parse(await navigator.clipboard.readText());
  } catch (e) { ticket = null; }
  if (!ticket || ticket.flipwarp !== 1) {
    var pasted = prompt('Paste what Flipwarp copied for you:');
    try { ticket = JSON.parse(pasted); } catch (e2) { ticket = null; }
  }
  if (!ticket || ticket.flipwarp !== 1) return say('That was not a Flipwarp ticket.');

  var csrf = (document.cookie.match(/scratchcsrftoken=([^;]+)/) || [])[1];
  if (!csrf) return say('You do not look signed in to Scratch in this browser.');

  var session = await fetch('https://scratch.mit.edu/session/', {
    credentials: 'include', headers: {'X-Requested-With': 'XMLHttpRequest'}
  }).then(function (r) { return r.json(); }).catch(function () { return null; });
  var token = session && session.user && session.user.token;
  if (!token) return say('Could not read your Scratch session. Try reloading the page.');

  var head = {
    'Content-Type': 'application/json',
    'X-CSRFToken': csrf,
    'X-Token': token,
    'X-Requested-With': 'XMLHttpRequest'
  };

  var wrote = await fetch('https://api.scratch.mit.edu/projects/' + id, {
    method: 'PUT', credentials: 'include', headers: head,
    body: JSON.stringify({title: ticket.title, instructions: ticket.instructions})
  });
  if (!wrote.ok) return say('Scratch refused the title and notes (' + wrote.status + ').');

  if (ticket.share) {
    var shared = await fetch('https://api.scratch.mit.edu/proxy/projects/' + id + '/share', {
      method: 'PUT', credentials: 'include', headers: head
    });
    if (!shared.ok) return say('Title and notes set, but sharing was refused (' + shared.status + ').');
    return say('Done. Title and notes set, and the project is shared.');
  }
  say('Done. Title and notes set. It is not shared; press Share when you are ready.');
}())`;

/**
 * The bookmarklet, as the single line a bookmark's address has to be.
 * @returns {string} the address
 */
export const bookmarklet = () => `javascript:${encodeURIComponent(BOOKMARKLET_SOURCE)}`;
