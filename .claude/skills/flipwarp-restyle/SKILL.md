---
name: flipwarp-restyle
description: Rebuild a finished Flipwarp/Scratch game the way a Scratcher would, without changing how it plays - pen-drawn menus, buttons and text into sprites, cryptic names into readable ones, one engine sprite and giant custom blocks into small pieces, lighter files. Use when the user asks to restyle, clean up, convert, de-lag or "make it like Scratch" for an existing game.
---

# Restyling a finished game

The game works. The job is to rebuild how it is built, not what it does:
after restyling it must play the same, and be what a good Scratcher would
have made. Sprites you can see and click instead of an engine that draws
everything, names a person can read, small pieces, a light file. Section 4
of `game_workflow` is the standard; `health_check` points at what misses it
(the kinds `pen-ui`, `pen-every-frame`, `one-big-sprite`, `giant-block`,
`fast-waits`, `short-names`, `many-costumes`, `huge-list`).

## The rules

- **Nothing about the game changes.** Same screens, same buttons, same
  controls, same feel, same scores. Never improve the gameplay or the art at
  the same time; if you see a bug, tell the person and leave it.
- **Never work on the only copy.** Open the readable `-source` copy if there
  is one (a release may be obfuscated and unreadable). Save as
  `<name>-restyled-source.sb3`, never over the original.
- **One part at a time, tested each time.** One screen, one sprite, one
  custom block: change it, play it, compare, save. If it plays differently,
  `undo` and do it again more carefully.
- **Cloud variables keep their names** (`rename` refuses them): their name is
  where online data lives.
- **Big games take more than one sitting.** Keep
  `<name>-restyle-notes.md` beside the game: the plan, what is done, what is
  left, and the before numbers. Read it first when you carry on.

## 1. Before anything: how it plays now

`load_project`, then record what "the same" means, and write it in the notes:

- `screenshot` (with `grid: true`) of every screen: title, menu, each
  popup, the game, pause, game over, win. Note where every button is.
- A `play` sequence through the main path (start, play for a bit, lose or
  win) and the state at the end (`get_state`): score, positions, gameState.
- `speed_report` at the busiest moment of the game, and in the menu.
- `health_check`, and the Scratch-way findings in it.

## 2. Survey and plan

`project_overview`, then `read_sprite` the big sprites (`find` helps in big
ones). Work out, and write in the notes:

- What is drawn with the pen, and where: menus, buttons, text, the HUD,
  things in the game (player, enemies, bullets, particles), the world (a
  tile map, a 3D view). Find the custom blocks that do each.
- How buttons work now: usually a mouse-down check against a rectangle, then
  something set or broadcast. That something is what the new button does.
- What each cryptic name holds (from where it is set and read).
- The parts of the engine sprite that stand on their own.

Tell the person the plan in a few lines, in this order (most help first):
safe fixes, names, menus and text, things in the game, splitting, lighter
file.

## 3. Safe fixes

- `fix_health` the `fast-waits` findings (unticks "run without screen
  refresh" where a block waits).
- **Names.** `rename` each cryptic variable, list, message, custom block
  and custom block input to what it holds or does: `bvx` → `ballSpeedX`,
  `aFS` → `aiFireSpeed`, input `a0` → `height`. `rename` changes every use,
  so the game works as before. Do a sprite at a time; `health_check` after.

## 4. Menus, buttons and text become sprites

For each screen the pen draws:

1. Show it (`set_variable` gameState, or click through) and `screenshot` it
   with the grid: that is the design to copy, positions and all.
2. Make it the Scratch way:
   - the background: a backdrop, or a sprite at the back;
   - each button: a sprite named for it (`PlayButton`) with costumes for
     normal and hover, drawn to match the screenshot (`preview_drawing`
     first), at the same place;
   - each title or fixed label: a sprite with the text drawn in its costume
     (SVG `<text>`, in the same font look and colour);
   - text that changes (score, timer, names): a variable display, or a
     sprite with a costume per character and a clone per character, set
     again only when the value changes.
3. Wire it up with what the old code did:
   - `whenThisSpriteClicked` does what the hit test did (the same variable
     set, the same broadcast, the same sound);
   - hover: `touching("_mouse_")` switches to the hover costume;
   - showing and hiding: `show`/`hide` at the moments the screen changes.
     Where the old code only changed a state variable, add a broadcast next
     to it ("show menu", "start game") and have the sprites listen.
4. Take out the old drawing and hit test for this screen only, and nothing
   else.
5. `screenshot` again and compare with the first one; `click` each button and
   check the same thing happens (state, next screen, sound). Save.

## 5. Things in the game become sprites and clones

Things the pen stamps in a 2D game (player, enemies, bullets, coins,
particles, pickups) become a sprite each, with a clone for each one when
there are many. Keep the game logic and the data it keeps (lists of
positions are fine); change only how it is drawn: each clone takes its own
item and goes there in `whenIReceive(render)`. The renderer then draws them,
and they can be clicked, seen and changed in the editor.

Leave the pen where it is the right tool: a 3D view (raycasting, and the
billboards inside it), trails and lines, drawing tools, a tile map. Then
make it redraw only when something changed (`if` the camera moved).

## 6. Split the big pieces

- **One sprite holding the game**: move each part that stands on its own
  into a sprite named for it (Menu, HUD, Ball, Enemies, Sounds), with its
  scripts and its own variables. Globals stay global. Parts talk with
  messages. After each move, play and compare.
- **Custom blocks over about 40 lines** (and every one over 300 blocks):
  split into steps with names that say what they do (`moveBall`,
  `checkGoals`, `drawScore`), called in order. `fast` only on the steps that
  loop over a lot of work in one frame.

## 7. A lighter file

- Costumes made as images by the thousand (every rotation, pre-rendered
  tiles): fewer costumes plus direction, size and effects, or levels as
  backdrops. Only where it looks the same.
- Lists saved with huge amounts in them: built when the game starts if they
  can be worked out; otherwise keep them and say so.
- Unused costumes and sounds: `fix_health` the tidy findings.

## 8. Finish

- `health_check`: the Scratch-way findings are gone, or each one left has a
  reason in the notes (a 3D view keeps its pen).
- `speed_report` at the same moments as before: write before and after.
- Play the main path again and compare with step 1: the same screens, the
  same results.
- Save `<name>-restyled-source.sb3`. If the person releases obfuscated
  copies, make `<name>-restyled.sb3` from it the way they usually do.
- Tell the person what changed, the before and after frame times, and
  anything left for another time.
