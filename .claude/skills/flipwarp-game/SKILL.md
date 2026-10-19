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
- Sprites and what each one does. Typical platformer: Stage (level),
  Tiles, Player, Coin, Enemy, plus anything special.
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

## 4. Rules that make Scratch games work

- **One frame loop.** The player's loop sends "render" every frame; every
  other sprite moves and draws itself in `whenIReceive(render)`. Never give
  each sprite its own forever loop with its own timing.
- **`define fast` for per-frame work.** Without "fast" every loop pass waits
  a frame. Never put `wait` inside game logic; count frames instead
  (`timer += 1; if (timer > 30) { ... }`).
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

## 5. Play it

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

## 6. Finish

- Title screen or instructions on the stage, a win and a lose.
- Feel: animation frames, a bounce when squashing enemies, the camera
  easing. The pieces already do the hard parts of feel; keep them.
- `save_project` if the user wants a file. Tell the user the controls, what
  to try, and anything you could not make work.

## Limits to know

- No sound tools yet: use the music extension blocks (`music.playNoteForBeats`)
  for simple effects, or leave sound to the user.
- Text cannot use blocks from extensions that are not Scratch's or Flipwarp's
  unless `set_extension_text` is on and the extension is loaded.
- Pieces are tuned for 30 frames a second. At 60, halve speeds and gravity.
