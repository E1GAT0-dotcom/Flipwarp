// START-HERE.html: the page in an export's folder that walks a person through
// putting it into Code.org, with a Copy button for each piece of code to
// paste and the pictures and sounds to upload shown by name.

const escapeHtml = text => String(text).replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;',
    '"': '&quot;'}[c]));
// Text placed inside a <script> as a JavaScript string, safe from ending the script early.
const scriptString = text => JSON.stringify(String(text)).replace(/</g, '\\u003c');

/**
 * Build START-HERE.html.
 * @param {object} spec {title, where, newProjectUrl, copies: [{label, name, text}], uploads: [{name, kind}],
 *     steps: [html]} where steps may name copies as {copy:N} and uploads as {uploads}
 * @returns {string} the page
 */
export const startHere = spec => {
    const copies = spec.copies.map((c, i) => `<div class="copy"><button data-copy="${i}">Copy ${escapeHtml(c.label)}` +
        `</button><span class="done" id="done${i}"></span><span class="what">${escapeHtml(c.name)}, ` +
        `${Math.max(1, Math.round(c.text.length / 1024))} KB</span></div>`);
    const pictures = spec.uploads.filter(u => u.kind === 'picture');
    const sounds = spec.uploads.filter(u => u.kind === 'sound');
    const uploads = (pictures.length ? `<div class="files">${pictures.map(u => `<figure><img src="${escapeHtml(u.name)}" ` +
        `alt=""><figcaption>${escapeHtml(u.name)}</figcaption></figure>`).join('')}</div>` : '') +
        (sounds.length ? `<ul class="sounds">${sounds.map(u => `<li>${escapeHtml(u.name)}</li>`).join('')}</ul>` : '');
    const steps = spec.steps.map(step => `<li>${step.replace(/\{copy:(\d+)\}/g, (m, n) => copies[Number(n)])
        .replace('{uploads}', uploads)}</li>`).join('\n');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(spec.title)}: putting it in ${escapeHtml(spec.where)}</title>
<style>
body { margin: 0; background: #f4f6f8; font: 15px/1.5 Helvetica, Arial, sans-serif; color: #3d4451; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; }
.sub { color: #6b7280; margin: 0 0 20px; }
ol { padding-left: 22px; }
li { margin: 0 0 18px; }
a.open, button { display: inline-block; border: none; border-radius: 6px; background: #855cd6; color: #fff;
  padding: 8px 14px; font: inherit; font-weight: bold; cursor: pointer; text-decoration: none; }
.copy { margin: 8px 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.what { color: #6b7280; font-size: 13px; }
.done { color: #2e7d32; font-weight: bold; }
.files { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
figure { margin: 0; width: 110px; background: #fff; border: 1px solid #dde2e8; border-radius: 6px; padding: 6px; }
figure img { display: block; width: 96px; height: 72px; object-fit: contain; margin: 0 auto;
  background: repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 50% / 12px 12px; }
figcaption { font-size: 11px; word-break: break-all; margin-top: 4px; }
.sounds { font-size: 13px; }
.note { background: #fff8e1; border-left: 4px solid #f2b705; padding: 8px 12px; border-radius: 4px; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(spec.title)}</h1>
<p class="sub">Exported from Flipwarp for ${escapeHtml(spec.where)}. Follow the steps; each Copy button puts that code on
your clipboard, ready to paste.</p>
<ol>
${steps}
</ol>
${spec.note ? `<p class="note">${spec.note}</p>` : ''}
</main>
<script>
var TEXTS = [${spec.copies.map(c => scriptString(c.text)).join(',\n')}];
function copyText(text, done) {
  function fallback() {
    var area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    done(ok);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
  } else {
    fallback();
  }
}
document.addEventListener('click', function (e) {
  var n = e.target.getAttribute && e.target.getAttribute('data-copy');
  if (n === null || n === undefined) return;
  copyText(TEXTS[Number(n)], function (ok) {
    document.getElementById('done' + n).textContent = ok ? 'Copied: now paste it' : 'Select it in the file and copy it';
  });
});
</script>
</body>
</html>
`;
};
