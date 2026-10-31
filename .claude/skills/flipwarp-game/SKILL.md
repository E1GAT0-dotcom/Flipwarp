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
- The art: one palette for the whole game, pixel art or SVG, sizes
  (the stage is 480x360; a tile is 24; a player about 16x24).
- The level map(s) as text rows.

Tell the user the plan in a few lines, then build.

Someone is usually watching the editor while you work. Before each step,
`narrate` one plain sentence of what you are about to do ("Drawing the
player: a red robot facing right, 16 by 24"). Each write shows them the
scripts that changed, glowing, and lists it in the activity strip.

## 3. Build in this order

1. **Stage**: `add_piece` level (pass your own ROWS). Add a backdrop
   (`add_costume` on "Stage", 480x360).
2. **Sprites**: `create_sprite` each one with its first costume. Draw with
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
  Fencing must be off (`set_game_options`).
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

- Title screen or instructions on the stage, a win and a lose.
- Feel: animation frames, a bounce when squashing enemies, the camera
  easing. The pieces already do the hard parts of feel; keep them.
- Sound: `add_sound` a preset for each thing that happens (jump, coin, hit,
  explosion, win, lose...) on the sprite it happens to, and `startSound("jump")`
  at that moment. Use `variation` and `pitch` so two sounds of a kind differ.
  You cannot hear them; `play_sound` lets the person hear one.
- Speed: if it might be heavy (pen drawing, many clones, 3D), get to the
  busiest part and run `speed_report`; fix what it points at.
- `save_project` if the user wants a file. Tell the user the controls, what
  to try, and anything you could not make work.

## Limits to know

- Sounds are made effects, not recordings or music: for a tune, use the
  music extension blocks (`music.playNoteForBeats`).
- Text cannot use blocks from extensions that are not Scratch's or Flipwarp's
  unless `set_extension_text` is on and the extension is loaded.
- Pieces are tuned for 30 frames a second. At 60, halve speeds and gravity.
