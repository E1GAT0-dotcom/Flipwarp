# flipwarp-mcp

Lets [Claude Code](https://claude.com/claude-code) read and write the project
open in Flipwarp, through the same text the Text button shows.

```
Claude Code  <-stdio->  flipwarp-mcp  <-WebSocket->  Flipwarp in your browser
```

Claude sees each sprite as Flipwarp text, writes a whole sprite back at a time,
and gets the editor's own refusals, with line numbers and hints, when it gets
something wrong. You watch it happen in the editor.

## Setting it up

```
npm install          # in the Flipwarp folder, once
npm run build
cd mcp && npm install
```

The `.mcp.json` in the Flipwarp folder registers the server with Claude Code
for anyone who opens that folder. Claude Code asks once before starting it.

Then, in Claude Code, ask for something ("make a platformer"). Claude calls
`open_editor`, which opens <http://127.0.0.1:8601/editor.html?mcp> in your
browser. The server serves the built editor itself, so nothing else needs to
be running. The `?mcp` is what makes the editor connect; without it Flipwarp
behaves exactly as normal.

## Tools

| Tool | What it does |
|---|---|
| `open_editor` | Opens the editor and waits for it to connect |
| `text_reference` | The rules of the text and every block it knows, or the blocks matching a search |
| `project_overview` | Sprites, costumes, sounds, variables, extensions |
| `read_sprite` | A sprite's scripts as text |
| `check_text` | Tries text without changing anything |
| `write_sprite` | Replaces a sprite's scripts with text; loads Scratch's and Flipwarp's extensions it uses |
| `undo` | Puts back the sprite the last write changed |
| `find` | Searches every sprite's text |
| `health_check` / `fix_health` | The project health check, and its automatic fixes |
| `create_sprite` / `delete_sprite` / `rename_sprite` / `select_sprite` | Sprites |
| `set_extension_text` | The "Text for other extensions' blocks" setting |
| `save_project` / `load_project` | `.sb3` files on this computer |
| `green_flag` / `stop` | Start and stop the project |
| `press_keys` / `hold_keys` / `release_keys` | Keyboard, by the names `keyPressed` uses |
| `click` / `move_mouse` | The mouse, in Scratch coordinates |
| `wait` | Let it run, then optionally a screenshot and the state |
| `screenshot` | The stage at 480×360, optionally with a labelled grid |
| `get_state` | Every sprite's position, costume, bubble and variables, clones, globals, timer, question |
| `pause` / `resume` / `step_frames` | Freeze, and run exact frames |
| `answer_question` | Answers an `askAndWait` |
| `get_logs` | Errors and warnings the page printed |
| `play` | A whole sequence of the above in one call |
| `preview_drawing` | Draws an SVG, pixel art or image file without adding it: zoomed, and at real size |
| `add_costume` | Adds a costume (or a backdrop, to `Stage`) and answers with a picture of it |
| `replace_costume` | Redraws a costume in place, keeping its name and number, and shows it |
| `list_costumes` / `costume_sheet` | Costumes as text, or side by side in one picture with their turning points |
| `rename_costume` / `delete_costume` / `switch_costume` | The rest |

| `game_workflow` | How to make a whole game: plan, draw, build from pieces, play it, fix it |
| `list_pieces` / `get_piece` / `add_piece` | The library of ready-made game pieces |
| `set_game_options` | Framerate, fencing, interpolation, high-quality pen, infinite clones, stored in the project |
| `set_variable` | Sets a variable while the game runs, to set up a test |
| `room` | Play with friends: hosts a room for the game (code and invite link), sends an update, closes it, says who is in it. Only the person can join someone else's room, and a friend's game open in the tab switches the other tools off |
| `add_sound` | Makes a sound effect from a preset (coin, jump, laser, explosion, hit, powerup, blip, select, bounce, whoosh, step, door, alarm, win, lose) or a recipe, or adds a .wav/.mp3, and describes it |
| `list_sounds` / `play_sound` / `rename_sound` / `delete_sound` | The rest; `play_sound` plays it out loud for the person watching |
| `speed_report` | Runs frames at full speed timing each frame, each script and the drawing: whether frames fit their time, where the time goes, clones, and what to try |
| `rename` | Renames a variable, list, message, custom block or custom block input everywhere it is used (not cloud variables) |
| `restyle_workflow` | How to rebuild a finished game the Scratch way without changing how it plays |
| `tidy_scripts` | Lays a sprite's scripts out again: events on the left, custom blocks on the right |
| `flag_issue` / `list_flags` / `resolve_flag` | Tells the person and every other chat about a bug, something slow, a missing tool or an idea; what others have flagged; taking one off once it is fixed |
| `narrate` | Shows the person watching a short note about what Claude is doing |
| `plan` | The checklist of Claude's steps and which one it is on: the progress bar in the editor, on the tab and in the control room |

Every tool also takes an optional `why`, shown to the person watching beside what it did.

### Ready-made pieces

`library/` holds Flipwarp text for the parts of a game that are hard to get
right and the same every time. `add_piece` merges one into a sprite, keeping
what the sprite already has, bringing the pieces it needs, and turning on
the game options it needs.

| Piece | Goes on | Does |
|---|---|---|
| `level` | Stage | The map as text rows (`#` solid, `.` air, `P` start, `o` coin, `e` enemy), sends "game start" |
| `collision` | any | `tileAt`, `solidAt`, `boxHits` against the map, worked out from the map, not from what is drawn |
| `tiles` | Tiles | Stamps the visible map with the pen each frame, one costume per map character |
| `platformer` | Player | Run, jump with coyote time, jump buffering and short hops, a following camera, animation by costume name |
| `topdown` | Player | Eight-way walking that slides along walls, a following camera, four-way animation |
| `coins` | Coin | A clone at every `o`; picking one up adds to `score` |
| `enemy` | Enemy | A clone at every `e`, walking its platform; hurts from the side, squashed from above |

They fit together through shared globals and messages (`list_pieces` sets
them out). One sprite's frame loop sends "render" and everything draws
itself then, so the screen moves together. `test/flipwarp/mcp-game.mjs`
builds a whole platformer from them through the tools and plays it frame by
frame: landing, head bumps, the map edge, the pit, coins, enemies.
`test/flipwarp/mcp-topdown.mjs` does the same for a top-down game: exact stops
against walls on all four sides, sliding along a wall at an angle, facing and
frames for each direction, and the camera scrolling both ways.

### The game-making skill

`.claude/skills/flipwarp-game/SKILL.md` is a Claude Code skill: how to plan a
game, draw it, build it from the pieces, and play it until it works. Claude
Code picks it up in this folder. Opened anywhere else, Claude reads the same
file through the `game_workflow` tool.

### Built the Scratch way

Games are taught to be built the way a Scratcher builds them (section 4 of
the skill): menus, buttons and text as sprites with costumes, game things as
sprites and clones, the pen only for 3D, trails and tile maps, one sprite
per thing, short custom blocks, readable names. This came from comparing
games made here with games people made: the made-here ones redrew their
menus with the pen every frame, kept the game in one engine sprite, and used
names like `bvx`. The health check now points those out (`pen-ui`,
`pen-every-frame`, `one-big-sprite`, `giant-block`, `fast-waits`,
`short-names`, `many-costumes`, `huge-list`), with thresholds the people's
games pass. `fix_health` unticks "run without screen refresh" on a custom
block that waits.

`.claude/skills/flipwarp-restyle/SKILL.md` (and the `restyle_workflow` tool)
is how to rebuild a finished game that way without changing how it plays,
using `rename` for the names.

### Drawing

Every drawing tool takes one of:

- `svg`: an SVG document. Its `width` and `height` are its size on the stage.
  Scratch itself sizes an SVG by its `viewBox`, so a drawing whose `viewBox`
  says otherwise is fitted to the `width` and `height` on the way in. The
  preview and the stage then agree.
- `pixels`: pixel art as text, a palette of single characters and rows of
  them, e.g. `{"palette": {"k": "#000", "g": "#4caf50"}, "rows": ["kggk", "gkkg"], "scale": 4}`.
  It goes in as an SVG of crisp squares (or a PNG with `"format": "png"`).
  A mistake comes back with its row and column.
- `file`: an `.svg`, `.png` or `.jpg` on this computer.

Every add and redraw answers with a picture, so Claude sees what it drew
before it moves on.

### Watching Claude work

With `?mcp`, the editor is something to watch rather than to work in:

- **Watching layout.** No block palette or add buttons; code, drawings and
  sounds can be looked at but not dragged. **Take over** gives the person
  the whole editor (Claude's changes are refused, with the reason, until
  they **Hand back**, and then Claude is told which sprites they changed).
- **Header**, in the menu bar: the chat's colour and its game's name, the step
  of its plan, a progress bar for what it is doing now (opening a project,
  saving, a play sequence, a wait), Follow, Take over, Download (a copy), and
  All chats (the control room). In full screen it shrinks to a small sign in
  the corner and the timeline goes, so nothing covers the game.
- **Follow.** The editor goes where Claude works: the sprite, the Costumes or
  Sounds tab, a bigger stage while it plays, staying on each view at least
  1.5 seconds. Clicking a tab or a sprite yourself stops following until you
  press Follow Claude. A marker ("Claude") moves to what it is working on.
- **Timeline**, over the code area: Claude's plan as a checklist, its latest
  `narrate` note, and a line for each thing it did with its `why`, a
  picture, and on a click the change itself (a write shows the text that
  changed). Replay plays the pictures back in order. At the bottom, a box
  to leave Claude a note (the pin points it at a sprite or a place on the
  stage); it reaches Claude with its next tool reply.
- **The tab** shows the chat's state in its title and icon (⏳ working with
  the plan's percentage, ✋ needs you, ✓ done, ⏸ paused, 💤 idle), so a row
  of tabs reads as a dashboard.
- **Layout.** New scripts go to the bottom of their column (events on the
  left, custom block definitions on the right), measured as drawn, and
  anything a write made overlap is pushed down. Comments sit beside the
  block they belong to. `tidy_scripts` lays out a whole sprite again.
- **Keys and clicks.** While Claude plays, the keys it holds light up over
  the stage, and clicks show as ripples.

None of it appears without `?mcp`.

### Several chats: the control room

Every server keeps a small status file (in the system temp folder,
`flipwarp-sessions`), and any of them shows `/control`: a card for every chat
with its game, plan and progress, what it is doing and why, a recent picture,
how hard it works the computer, notes waiting, and Pause / Resume / Pause
all but this. Alerts (a sound, and a notification if allowed) when a chat
finishes or needs you. A chat leaves it when it ends.

Below the cards is what chats have **flagged**: bugs, slow things, missing tools
and ideas that matter beyond the chat that found them, most-hit first. Claude is
told to flag as soon as it notices, and to look there when Flipwarp seems wrong.
A second chat hitting the same thing adds to the same flag. **Resolved** takes one
off. They are kept in `mcp/flags.jsonl`, which is not in git.

### Updating while chats work

`tools.mjs` holds every tool but `open_editor` and `plan`; `server.mjs` holds
the connections. When `tools.mjs`, the guide, the sounds or a piece changes,
the server takes the old tools away and registers the new ones over the same
connections, and Claude Code is sent the "tool list changed" notice; the
editor tab and the game stay as they are. A change that does not load keeps
the old tools. A change to `server.mjs` itself needs the chat to reconnect,
and Claude is told so.

Each tab reports the editor build it loaded. When the editor has been rebuilt
since, Claude is told (once) to save and have the tab reloaded, and the tab
says the same; a request an older tab does not know comes back saying that,
instead of "unknown request".

### Keep the tab visible while Claude plays

A browser slows a hidden tab to about one frame a second, so the game runs in
slow motion while Claude waits in real time. Claude is told when the tab is
hidden. `step_frames` is not affected: it runs exact frames at full speed
either way, which is also the most reliable way for Claude to test movement.

A hidden tab also gets little of a busy computer, so a big project can take minutes
to open behind another tab. So `open_editor` opens Flipwarp in a Chrome (or Edge)
window of its own, told not to slow its hidden tabs, with its own profile in
`~/.flipwarp/browser`. `FLIPWARP_OWN_BROWSER=0` uses the default browser instead.
However it was opened, a hidden tab only draws its blocks once someone looks.

Tabs Claude uses are **muted** until you press **Muted** in the menu bar, which
is remembered. The ordinary editor, without `?mcp`, plays sound as normal.

If several Flipwarp tabs have `?mcp`, the first one to connect is the one used
until it closes. Claude is not switched to another project halfway through.

Each server marks the tabs it opens with its own `chat=` key. A tab left open
from a chat that has ended is refused by the next server to get its port.
Once its chat has ended (refused, or no server for a minute) the tab closes
itself if its project has been saved since its last change; otherwise it
says to save first. A tab opened by hand is never closed.

### Idle pause

A game left running with nobody using it is paused after 90 seconds: no
request from Claude and no key, click or scroll on the page. The activity
strip says so. The next request from Claude, or any key or click, carries on,
with no jump in the game's timers. A pause Claude asked for itself is left
alone. `?idle=<seconds>` in the address changes the time, for testing.

## Settings

| Variable | Default | |
|---|---|---|
| `FLIPWARP_PORT` | `8601` | Where the editor is served and connects. A range (`8611-8640`) takes the first free port in it, so several Claude Code chats can each have their own editor |
| `FLIPWARP_OPEN` | | `1` opens the editor in the browser as soon as Claude Code starts the server |
| `FLIPWARP_BUILD` | `../build` | The built editor to serve |
| `FLIPWARP_ORIGINS` | | Extra page origins allowed to connect, comma separated, for a copy of the editor hosted elsewhere (open it with `?mcp=8601`) |

Only pages on this computer (localhost, 127.0.0.1) can connect by default, so
a website you visit cannot pretend to be the editor.

## Testing

```
node test/flipwarp/mcp-guide.mjs              # every example Claude is taught parses
node test/flipwarp/other-extension-text.mjs   # the extension setting round-trips
node test/flipwarp/mcp-pixels.mjs             # pixel art is read, drawn, and refused with its place
node test/flipwarp/mcp-sounds.mjs             # every sound preset makes a clean WAV (SAVE_SOUNDS=dir to listen)
node test/flipwarp/mcp-pieces.mjs             # every piece builds, alone and merged
node test/flipwarp/reporter-in-dropdown.mjs   # switchCostume(join(...)) round-trips
node test/flipwarp/turbowarp-detector.mjs     # isTurboWarp() and isCompiled() round-trip
node test/flipwarp/saved-short-form.mjs       # variables saved in short form compare as blocks
node test/flipwarp/mcp-end-to-end.mjs         # then open the editor address above
node test/flipwarp/mcp-game.mjs               # builds and plays a whole platformer (same)
node test/flipwarp/mcp-topdown.mjs            # builds and plays a whole top-down game (same)
node test/flipwarp/mcp-many-chats.mjs         # two chats, two editors; open the two addresses it prints
node test/flipwarp/mcp-watching.mjs           # plan, control room, notes, take over, tools reloading, old tabs
```

The play tests start their own server. While Claude Code is open in this
folder its own copy has port 8601, so run them with `FLIPWARP_PORT=8602` and
open the editor on that port instead.
