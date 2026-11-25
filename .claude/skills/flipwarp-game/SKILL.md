---
name: flipwarp-game
description: Make a whole game in Flipwarp (a Scratch/TurboWarp editor) through the flipwarp MCP tools - plan it, draw the sprites, build it from tested pieces, then play it and fix it until it works. Use when the user asks for a game, a level, or a big feature in a Flipwarp/Scratch project ("make a platformer", "add enemies", "make it like Mario").
---

# Making a game in Flipwarp

You are building a real Scratch project that a person will play. The flipwarp
tools let you write every sprite as text, draw costumes, and play the game
yourself. A game is not finished when it is written; it is finished when you
have played it and it works.

## 1. Start

1. `open_editor`, then `project_overview`.
2. `text_reference` once, so you write the text correctly first time.
3. `list_pieces`: tested pieces for the hard parts. Never rewrite physics,
   collision, a camera or a tile renderer by hand when a piece does it.

## 2. Plan, briefly, and say it

Decide (ask the user only if the request truly leaves it open):

- Genre, controls, the goal, how you win and how you lose.
- Sprites and what each one does: one sprite for each kind of thing on
  screen, named for what it is. Typical platformer: Stage (level), Tiles,
  Player, Coin, Enemy, plus a sprite for each button and title (Title,
  PlayButton, ScoreBoard...).
- The art, and where each piece comes from (see "Art" below): one look
  for the whole game, and sizes that fit the stage (see "Sizes and
  limits").
- What makes it more than a demo (see "A full game, not a demo"): the
  levels or waves, what changes as you go, and the extras.
- The level map(s) as text rows.

Tell the user the plan in a few lines, then build. Put the same steps on
screen with `plan` (steps, and the game's name), and call `plan` with
`current` as you reach each one: it is their progress bar.

Someone is usually watching the editor while you work; it follows you to
what you are working on. Before each step, `narrate` one plain sentence of
what you are about to do ("Drawing the player: a red robot facing right, 16
by 24"), and give tools a short `why`. Each write shows them the scripts that
changed, glowing, and lists it in the timeline. Notes they leave you come
back in tool replies: act on them.

### Art

Don't draw everything yourself out of a few circles and rectangles. In
order:

1. **Files the person gave you**, or assets made for this game in its
   own folder: use those.
2. **Scratch's own library** (`library`): 333 sprites, 859 costumes, 85
   backdrops and 353 sounds drawn and recorded by people, with animation
   frames. `search` it for each thing in the plan (a character, an
   animal, a car, a place, a button, music), `look` before you `add`.
   Good for characters, creatures, objects, backdrops, music loops and
   real sound effects. Mix library art only when the styles match.
3. **Draw your own** when the game needs its own look, or nothing fits.
   Then draw like an artist, not a placeholder: outlines, two or three
   shades per colour (light from one side), details that say what it is
   (eyes, a visor, wheels, bolts, leaves), several animation frames
   (walk at least 2 to 4, plus idle, jump, hurt). `preview_drawing` and
   improve it until it would look right in a published Scratch game.
   A backdrop is a place: sky, distance, ground and detail, not one flat
   colour.

### Sizes and limits

Scratch has hard limits; plan within them so nothing is cut, blurred or
refused.

- **The stage is 480x360** (x from -240 to 240, y from -180 to 180), and
  that is the size of the screen the game is played on. A player is about
  1/10 to 1/6 of the stage's height (36 to 60 steps for a character in
  most games; 16 to 24 for a tiny pixel-art hero on a 24-step tile grid).
  Text must be at least about 12 steps high to read.
- **Sprites can't be scaled without limit.** With fencing on (the default,
  and always on scratch.mit.edu) a sprite is never shown bigger than
  1.5 times the stage (720x540) or smaller than about 5 steps, and at least
  15 steps of it stays on the stage. Draw costumes at the size they are
  used instead of `setSize(400)`; turn fencing off (`set_game_options`)
  only for scrolling games, and see "World coordinates" below for what
  Scratch's website does anyway.
- **Bitmaps blur when scaled up.** A .png at resolution 1 is one pixel per
  step; scaled past 100% it goes soft. Draw bitmaps at 2x (`resolution: 2`)
  for sharpness. A bitmap bigger than 960x720 pixels is shrunk to fit.
- **Resolution 1 bitmaps cost 4 times the memory.** Scratch redraws every
  resolution 1 bitmap at double size when the project loads, and saves it
  back as a PNG: one 7.8 MB project of photos grew to 54 MB and crashed the
  tab. For many or large bitmaps (photos, big backdrops, tile sets), always
  add them with `resolution: 2` (an image twice the size it shows); a .jpg
  at resolution 2 stays a small .jpg.
  Vector (SVG) costumes stay sharp at any size: prefer them for anything
  that scales.
- **Costumes turn around their rotation centre.** Put it at the feet for a
  character that stands on the ground, the middle for things that spin.
- **300 clones at once** in Scratch (more only with infinite clones, which
  scratch.mit.edu ignores). A list holds 200,000 items on Scratch. Speech
  bubbles show at most 330 characters. The pen size is 1 to 1200.
- **Cloud variables**: numbers only, at most 256 digits each, 10 per
  project, and Scratch sends about 10 changes a second.
- **File size**: scratch.mit.edu refuses a project.json over 5 MB or any
  one costume or sound over 10 MB. Long WAV sounds are big (about 2.6 MB
  a minute); keep music short and looping.
- **Big projects are slow and fragile in the editor.** Over about 20 MB, or
  over a thousand costumes, loading takes minutes and a tab can freeze or
  reload, losing what was not saved. Keep games well under that. With a big
  one: `save_project` after every few changes, not only at the end; tell the
  person before loading anything over 20 MB; and for a huge one, edit a
  light copy (the same project with most pictures swapped for a tiny
  placeholder) and copy the changed sprites back.
- TurboWarp's options (60 fps, no fencing, infinite clones) are kept in the
  project for Flipwarp and TurboWarp; Scratch's own website ignores them,
  so a game meant for scratch.mit.edu must work without them.

### A full game, not a demo

A person asked for a game they will want to play and share, not a test of
one mechanic. Aim for what a good game on the Scratch front page has:

- **Content**: several levels, waves or rounds (at least 3 to 5), each
  adding something: a new enemy, hazard, mechanic or layout. Difficulty
  that rises.
- **Depth**: more than one thing to do: collect, avoid, fight, unlock,
  upgrade or score combos. Something to aim for: a high score, stars,
  a time to beat, a secret.
- **Feel**: animation for every moving thing, particles or a flash on
  hits and pickups, screen shake for big moments, sound for every event,
  music, the camera easing.
- **Screens**: a title with the game's name drawn in a costume, a
  pause, a game over with the score, a win, and a way to play again.
- **Looks**: a real backdrop for each place, a HUD that fits the style,
  no default Scratch cat or plain circles left in.

Before you say it is done, go through that list and the plan, and add
what is missing. If the person asked for something small, still make
that small thing complete and polished.

## 3. Build in this order

1. **Stage**: `add_piece` level (pass your own ROWS). Add a backdrop
   (`add_costume` on "Stage", 480x360).
2. **Sprites**: `create_sprite` each one with its first costume, or
   `library` "add" a library sprite with its frames. Draw with
   the loop: `preview_drawing`, look, fix, then add. Animation frames with
   `add_costume`, then `costume_sheet` to check they line up.
3. **Pieces**: `add_piece` tiles on "Tiles" (one costume per drawn map
   character, named that character), platformer or topdown on "Player",
   coins, enemy.
4. **Your own code**: `read_sprite`, add to it, `check_text`, `write_sprite`.
   Follow the rules below.
5. `health_check` and fix what it finds.

## 4. Build it the way a Scratcher would

The person will open this in Scratch, look inside and remix it. Build it the
way a good Scratcher builds, which is also what runs fastest: sprites you can
see and click, not an engine that draws everything. These come from
comparing games made here with the person's own games; the made-here ones
lagged and could not be edited.

- **Screens are backdrops and sprites, not drawings.** Title, menu, pause,
  game over and win: a backdrop (`switchBackdropTo`) and sprites that `show`
  and `hide`. Never redraw a still screen every frame.
- **A button is a sprite.** Its costumes are its looks (normal, hover,
  pressed); `whenThisSpriteClicked` does what it does; `touching("_mouse_")`
  for hover. Never a rectangle you test the mouse against.
- **Text that does not change is drawn into a costume** (an SVG with
  `<text>`, or pixel letters) on a sprite placed where it shows. `say` for
  speech. A score: a variable display (`showVariable`), or a sprite with one
  costume per digit and a clone per digit. A letter engine (one costume per
  character, stamped or cloned) only for text that really changes, like a
  player's name or chat, and then only redrawn when the text changes.
- **Things in the game are sprites and clones**: player, enemies, bullets,
  coins, particles, doors. They move themselves (`changeX`, `goToXY`,
  `glide`) and the renderer draws them. Nothing that a player would want to
  inspect is a pen stamp.
- **The pen is for**: real 3D (raycasting), lines and trails, drawing tools,
  and a scrolling tile map (the tiles piece, which redraws only when the
  camera moves). Not for menus, buttons, text, the HUD, intros or sprites.
  If the pen redraws every frame, the whole frame is drawn twice.
- **An intro or logo animation is a sprite with costumes** (`nextCostume`,
  `glide`, `changeEffect`), not points drawn with the pen.
- **Small pieces.** One sprite per thing, each with the scripts for that
  thing; no sprite holding most of the game. A custom block that is longer
  than a screen (about 40 lines) is split into smaller ones with clear names.
- **Names a person can read.** `playerSpeed`, `jumpPower`, `coinsLeft`,
  `Is jumping?`: never `ps`, `v2`, `a0`. Custom block inputs too: `jump(height)`,
  not `jump(a)`.
- **Collision with `touching` when there is no tile map**: enemies, pickups,
  hazards, the goal. Map maths only for walls and floors of a tile map.
- **A few costumes, a few list items.** Tens of costumes per sprite, not
  thousands; levels as backdrops or as map rows, not millions of list items.
  Big files load slowly and Scratch refuses projects over its size limit.
- **`define fast` only where it is needed**: loops that must finish within
  one frame (drawing a map, sorting, maths over a list). Not on every custom
  block, and never on one that waits, asks, glides or says for seconds: those
  do not wait inside a fast block.
- **Comments** on every sprite saying what it does, and on anything clever.

## 5. Rules that make Scratch games work

- **One frame loop.** The player's loop sends "render" every frame; every
  other sprite moves and draws itself in `whenIReceive(render)`. Never give
  each sprite its own forever loop with its own timing.
- **Per-frame work does not wait.** Never put `wait` inside game logic;
  count frames instead (`timer += 1; if (timer > 30) { ... }`). A custom
  block that loops over many things each frame is `define fast`.
- **World coordinates and the camera.** Positions live in variables
  (worldX, worldY); draw with `goToXY(worldX - viewX, worldY - viewY)`.
  Fencing off (`set_game_options`) lets sprites go off the edge in
  Flipwarp and TurboWarp, but scratch.mit.edu ignores that and always
  fences: sprites that should be off screen bunch up at the edges, and
  `xPosition() < -260` is never true. So every sprite that can leave the
  screen checks after `goToXY`: if `abs(xPosition() - screenX) > 0.5` (or
  y), Scratch pushed it back, so it hides and sets `onScreen = 0`. Check
  `touching` only while `onScreen = 1` (hidden sprites still touch on
  Scratch), and delete clones by their world position, never by
  `xPosition()`. Test with `set_game_options` fencing on to see what
  Scratch shows.
- **Collision from the map, not from pictures.** Walls and floors through
  `tileAt` / `solidAt` / `boxHits` (the collision piece). `touching` and
  distance checks are fine for pickups and hits.
- **Clones for many things.** The isClone pattern from the coins piece:
  the original stays hidden and makes clones; each clone keeps its own
  variables; on "game start" old clones delete themselves.
- **A state variable** (`gameState = "play"`, `"dead"`, `"won"`) instead of a
  web of messages. Title screen, game over and win are states.
- **Shared names are a contract.** Globals and messages one sprite sets and
  another reads are declared in both. Keep the names from the pieces.
- Short scripts with clear names and a `#` comment on anything not obvious.

## 6. Play it

After every feature, play it. This is not optional.

- `green_flag`, then `play` with a sequence a player would do: hold keys,
  wait, press, `screenshot`, `state`.
- For exact checks use `pause` and `step_frames`: they run real frames at
  full speed even if the tab is hidden. Example: hold "right arrow",
  `step_frames` 30, `get_state`, the player's px went up by about 30 times
  its speed and it did not go through the wall.
- `set_variable` to set up a moment: put the player next to an enemy, at the
  edge of a pit, one coin from winning.
- `screenshot` (with `grid: true` when placing things) to see it: is
  everything the right size, visible against the backdrop, lined up?
- `get_logs` if something does nothing at all.

Fix, then play again. When something is wrong, find out why from the state
before changing code; do not guess.

## 7. Finish

- A title screen, a win and a lose. Controls go in the project's
  Instructions text (and in what you tell the person), not on the screen:
  no hint bars, "Press X to..." banners or tutorial pop-ups. Let the game
  teach through feedback instead: a sound, particles, a glow on the thing
  to use, a character reacting.
- Feel: animation frames, a bounce when squashing enemies, the camera
  easing. The pieces already do the hard parts of feel; keep them.
- Sound: every game sounds like itself, never like the last game. Choose
  the `style` that fits this game (chiptune, soft, arcade, space, cartoon,
  toy, heavy, lofi, eerie) and give it to every `add_sound`. Shape the
  game's main sounds with `custom` (wave, pitch, slide, echo, detune, crush)
  so they suit what makes them: a slime's jump is not a robot's. Then
  `add_sound` one for each thing that happens (jump, coin, hit, explosion,
  win, lose...) on the sprite it happens to, and `startSound("jump")` at that
  moment. Real recorded sounds and music loops come from `library` (kind
  "sound"); mix them with made ones in the same mood. Don't copy sound
  files or recipes from other games. Note the style
  in the game's notes so later changes match. You cannot hear them;
  `play_sound` lets the person hear one.
- Speed: if it might be heavy (pen drawing, many clones, 3D), get to the
  busiest part and run `speed_report`; fix what it points at.
- `export_project` when the person wants the game as code for somewhere
  else (target "weblab": Code.org Web Lab, or any web page; "python": a pygame
  program, run with python main.py; "gamelab": Code.org Game Lab). Pass on what its
  reply says did not come across, and that README.txt says how to put it in.
- `save_project` if the user wants a file. Tell the user the controls, what
  to try, and anything you could not make work.

## Tell the other chats

Every chat starts knowing nothing, so what you find the next one finds again.
When something would matter beyond this chat, call `flag_issue` straight away
and carry on: a bug in Flipwarp or its tools, something slow, a missing tool, a
guide or piece that misled you, or an idea that would help everyone. Do it even
if you found a way round, and even if you are not sure. Not for bugs in the game
you are making. If Flipwarp itself seems wrong, `list_flags` first: another chat
may have the answer.

## Limits to know

- `add_sound` makes effects, not recordings or music. For real recorded
  sounds and music loops, `library` "search" kind "sound" (try "loop",
  "music", "drum", or the thing that makes the sound); for a tune of your
  own, the music extension blocks (`music.playNoteForBeats`).
- Text cannot use blocks from extensions that are not Scratch's or Flipwarp's
  unless `set_extension_text` is on and the extension is loaded. For a
  TurboWarp gallery extension (Gamepad, Pen+...), `add_extension` loads it
  and lists its blocks: never patch project.json by hand for it. Such games
  play in TurboWarp and Flipwarp, not on scratch.mit.edu.
- Pieces are tuned for 30 frames a second. At 60, halve speeds and gravity.
