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

### Keep the tab visible while Claude plays

A browser slows a hidden tab to about one frame a second, so the game runs in
slow motion while Claude waits in real time. Claude is told when the tab is
hidden. `step_frames` is not affected: it runs exact frames at full speed
either way, which is also the most reliable way for Claude to test movement.

If several Flipwarp tabs have `?mcp`, the first one to connect is the one used
until it closes. Claude is not switched to another project halfway through.

## Settings

| Variable | Default | |
|---|---|---|
| `FLIPWARP_PORT` | `8601` | Where the editor is served and connects |
| `FLIPWARP_BUILD` | `../build` | The built editor to serve |
| `FLIPWARP_ORIGINS` | | Extra page origins allowed to connect, comma separated, for a copy of the editor hosted elsewhere (open it with `?mcp=8601`) |

Only pages on this computer (localhost, 127.0.0.1) can connect by default, so
a website you visit cannot pretend to be the editor.

## Testing

```
node test/flipwarp/mcp-guide.mjs              # every example Claude is taught parses
node test/flipwarp/other-extension-text.mjs   # the extension setting round-trips
node test/flipwarp/mcp-pixels.mjs             # pixel art is read, drawn, and refused with its place
node test/flipwarp/mcp-pieces.mjs             # every piece builds, alone and merged
node test/flipwarp/reporter-in-dropdown.mjs   # switchCostume(join(...)) round-trips
node test/flipwarp/mcp-end-to-end.mjs         # then open the editor address above
node test/flipwarp/mcp-game.mjs               # builds and plays a whole platformer (same)
node test/flipwarp/mcp-topdown.mjs            # builds and plays a whole top-down game (same)
```

The play tests start their own server. While Claude Code is open in this
folder its own copy has port 8601, so run them with `FLIPWARP_PORT=8602` and
open the editor on that port instead.
