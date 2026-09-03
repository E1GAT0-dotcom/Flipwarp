# Flipwarp

A Scratch editor where one button turns your blocks into text you can edit, and
turns the text back into blocks.

Press **Text** in the corner of the code area and the sprite you are looking at
becomes a page of readable code. Edit it, press **Blocks**, and the workspace is
rebuilt from what you wrote — same scripts, same places on the canvas, same
comments. Nothing about the editor changes until you press the button: until
then it is Scratch, with Scratch's blocks.

```
@at(40, 60)
whenGreenFlagClicked {
  # how far the cat walks
  move(10);
  repeat (4) {
    turn(90);
    say("hello", 2);
  }
}
```

Flipwarp is a fork of [TurboWarp](https://turbowarp.org/), which is itself a
fork of Scratch. Everything TurboWarp does — the compiler, the addons, the
custom extensions — still works.

## What the text is

It is not JavaScript, and it does not try to be. There is exactly one way to
write each Scratch block, and Flipwarp refuses anything outside that set rather
than guessing at it. When it refuses it says which line, what is wrong, and what
to do instead — usually pointing at how Scratch does the same thing.

That restriction is the whole reason the round trip is safe. Converting a sprite
to text and straight back leaves the project byte-for-byte as it was, which was
checked across 444 blocks covering 226 different opcodes.

Comments are part of the text. A `#` line with a block under it becomes that
block's comment; a `#` line on its own becomes a comment on the canvas. Both are
real Scratch comments — the yellow boxes you can drag, fold and resize.

Where each script sits on the canvas is kept in `@at(x, y)` markers, hidden
unless you turn them on in **Advanced → Flipwarp**.

## Extensions

Flipwarp can serve PenguinMod's extension gallery from your own copy of the site
rather than fetching it from PenguinMod every time someone opens your editor.
Open `flipwarp-check.html` on the uploaded site, run the check, and use the two
download buttons; unzip the results next to `editor.html` so a folder called
`penguinmod` sits beside it. The PenguinMod tab in the extension picker lists
whatever is in that folder.

Extensions written for PenguinMod sometimes ask for hooks this engine does not
have. Rather than forking their extensions, those hooks are added once in
`src/lib/flipwarp/penguinmod-compat.js`, so their extensions keep updating on
their own. `flipwarp-check.html` is what finds the gaps.

Extension blocks do not have a text form. Their blocks work; the Text button
refuses on a sprite that uses one, and says so.

## Building

```
npm install
npm run build
```

The finished site lands in `build/`. Upload that folder to any static host and
open `editor.html`. `start-flipwarp.bat` runs it from a folder on Windows — a
browser will not let a page opened straight off your disk read the files next to
it, so it needs a real server even locally.

Two notes for a fresh checkout: `npm install` pulls two test-only tools that
download large binaries, which the included `.npmrc` switches off; and
`scripts/prepublish.mjs` downloads micro:bit firmware, without which only the
micro:bit extension is affected.

Flipwarp's own tests live in `test/flipwarp/`. Most drive a real browser against
a built copy of the site being served locally:

```
npm install --no-save playwright && npx playwright install chromium
npm run build
cd build && python3 -m http.server 8099
node test/flipwarp/comments-engine.mjs      # in another terminal
```

## Credits

Scratch is by the [Scratch Foundation](https://scratch.org/). TurboWarp is by
[GarboMuffin](https://github.com/GarboMuffin) and contributors, and Flipwarp
would not exist without it — the extension gallery under the TurboWarp tab is
theirs. PenguinMod's extensions belong to their individual authors and are used
under the MIT licence; `penguinmod/CREDITS.txt` names each one.

Flipwarp is by **E1GAT0_**.

## License

Flipwarp is licensed under the GNU General Public License v3.0, as it must be:
TurboWarp's modifications to Scratch are GPLv3, and this is built on them. See
`LICENSE`.

The original scratch-gui license, which must be retained:

```
Copyright (c) 2016, Massachusetts Institute of Technology
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

`src/lib/default-project/dango.svg` is based on
[Twemoji](https://twemoji.twitter.com/) and is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
