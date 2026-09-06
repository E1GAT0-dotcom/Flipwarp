// The program that runs on Scratch's side of the fence.
//
// Kept in a file of its own, and as an ordinary string rather than as code,
// because it is not code this site ever runs. It is copied into a bookmark,
// and a bookmark's address has to be one self-contained line: it cannot fetch
// anything from Flipwarp, because Flipwarp may not be reachable from wherever
// the browser happens to be, and a bookmark that only works on one network
// fails silently on the day it is needed.
//
// What it does, in order: reads what to publish from the clipboard, checks who
// you are with the cookie Scratch gave this browser, asks for the .sb3, opens
// it, sends every costume and sound, sends the project, sets the title and the
// notes, and shares it if that was asked for.
//
// Opening the .sb3 means reading a zip. There is a small reader below for it.
// The browser can undo the compression itself, so all that is left is finding
// where in the file each piece begins, which the zip's own directory says.
//
// Two things it will not do quietly. It only ever writes to the project named
// in the ticket or the one whose page you are standing on, and it asks before
// making a new project, because people who have automated this before have
// found that making a lot of them quickly gets accounts banned.
//
// Every backslash here is doubled: this is a template literal, so a single one
// would be eaten before the program ever reached a bookmark.

export const BOOKMARKLET_SOURCE = `(async function () {
  var tell = function (m) { alert('Flipwarp: ' + m); };
  if (!location.hostname.endsWith('scratch.mit.edu')) {
    return tell('Press this while you are on Scratch.');
  }

  var ticket = null;
  try { ticket = JSON.parse(await navigator.clipboard.readText()); } catch (e) { ticket = null; }
  if (!ticket || ticket.flipwarp !== 1) {
    try { ticket = JSON.parse(prompt('Paste what Flipwarp copied for you:')); } catch (e) { ticket = null; }
  }
  if (!ticket || ticket.flipwarp !== 1) return tell('That was not a Flipwarp ticket.');

  var here = location.pathname.match(/projects\\/(\\d+)/);
  var id = ticket.id || (here ? here[1] : '');

  var csrf = (document.cookie.match(/scratchcsrftoken=([^;]+)/) || [])[1];
  if (!csrf) return tell('You do not look signed in to Scratch in this browser.');
  var session = await fetch('https://scratch.mit.edu/session/', {
    credentials: 'include', headers: {'X-Requested-With': 'XMLHttpRequest'}
  }).then(function (r) { return r.json(); }).catch(function () { return null; });
  var token = session && session.user && session.user.token;
  if (!token) return tell('Could not read your Scratch session. Reload the page and try again.');
  var auth = {'X-CSRFToken': csrf, 'X-Token': token, 'X-Requested-With': 'XMLHttpRequest'};

  var file = await new Promise(function (done) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sb3';
    input.onchange = function () { done(input.files[0] || null); };
    input.click();
  });
  if (!file) return tell('No file chosen.');
  var buffer = new Uint8Array(await file.arrayBuffer());
  var view = new DataView(buffer.buffer);

  var end = -1;
  for (var i = buffer.length - 22; i >= 0 && i > buffer.length - 66000; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return tell('That is not a project file. Pick the .sb3 Flipwarp saved.');
  var count = view.getUint16(end + 10, true);
  var at = view.getUint32(end + 16, true);

  var pieces = [];
  for (var n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    var how = view.getUint16(at + 10, true);
    var packed = view.getUint32(at + 20, true);
    var nameLength = view.getUint16(at + 28, true);
    var extraLength = view.getUint16(at + 30, true);
    var commentLength = view.getUint16(at + 32, true);
    var where = view.getUint32(at + 42, true);
    var name = new TextDecoder().decode(buffer.subarray(at + 46, at + 46 + nameLength));
    var localName = view.getUint16(where + 26, true);
    var localExtra = view.getUint16(where + 28, true);
    var from = where + 30 + localName + localExtra;
    pieces.push({name: name, how: how, bytes: buffer.subarray(from, from + packed)});
    at += 46 + nameLength + extraLength + commentLength;
  }

  var unpack = async function (piece) {
    if (piece.how === 0) return piece.bytes;
    var stream = new Blob([piece.bytes]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };

  var manifest = pieces.filter(function (p) { return p.name === 'project.json'; })[0];
  if (!manifest) return tell('That zip has no project inside it.');
  var projectJson = new TextDecoder().decode(await unpack(manifest));
  var assets = pieces.filter(function (p) { return p.name !== 'project.json'; });

  for (var k = 0; k < assets.length; k++) {
    var body = await unpack(assets[k]);
    var sent = await fetch('https://assets.scratch.mit.edu/' + assets[k].name, {
      method: 'POST', credentials: 'include', headers: auth, body: body
    });
    if (!sent.ok) return tell('Scratch would not take ' + assets[k].name + ' (' + sent.status + ').');
  }

  var head = Object.assign({'Content-Type': 'application/json'}, auth);
  if (id) {
    var over = await fetch('https://projects.scratch.mit.edu/' + id, {
      method: 'PUT', credentials: 'include', headers: head, body: projectJson
    });
    if (!over.ok) return tell('Scratch would not save over project ' + id + ' (' + over.status + ').');
  } else {
    var ask = 'Make a NEW project on Scratch?' +
      String.fromCharCode(10, 10) +
      'Making a lot of these quickly can get an account banned, so do it sparingly.';
    if (!confirm(ask)) return tell('Nothing was published.');
    var made = await fetch('https://projects.scratch.mit.edu/?is_remix=0&title=' +
      encodeURIComponent(ticket.title || 'Untitled'), {
      method: 'POST', credentials: 'include', headers: head, body: projectJson
    });
    if (!made.ok) return tell('Scratch would not make the project (' + made.status + ').');
    var answer = await made.json();
    id = answer['content-name'];
    if (!id) return tell('Scratch made something but did not say what.');
  }

  var named = await fetch('https://api.scratch.mit.edu/projects/' + id, {
    method: 'PUT', credentials: 'include', headers: head,
    body: JSON.stringify({title: ticket.title, instructions: ticket.instructions})
  });
  if (!named.ok) return tell('Uploaded, but Scratch refused the title and notes (' + named.status + ').');

  if (ticket.share) {
    var shared = await fetch('https://api.scratch.mit.edu/proxy/projects/' + id + '/share', {
      method: 'PUT', credentials: 'include', headers: auth
    });
    if (!shared.ok) return tell('Uploaded and named, but sharing was refused (' + shared.status + ').');
  }

  location.href = 'https://scratch.mit.edu/projects/' + id + '/';
}())`;
