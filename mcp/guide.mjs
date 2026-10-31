// What Claude is told about the text before it writes any. Every example here
// was put through the real parser and back; if the language changes, run them
// again (test/flipwarp/mcp-guide.mjs does).

export const GUIDE = `# Flipwarp text

Every sprite (and the Stage) is one document of text. The text IS the blocks:
there is exactly one way to write each block, and anything else is refused with
the line number, what is wrong, and how to fix it. Write a whole sprite at a
time with write_sprite; it replaces every script in that sprite.

## Declarations go first

    variable speed;
    global variable score;
    list inventory;
    global list highScores;
    global broadcast gameOver as "game over";
    variable hp as "hit points";

- variable / list: this sprite only. global: every sprite (kept on the Stage).
- Messages are always global broadcasts.
- "as" gives the real Scratch name when it has spaces or symbols.

Every variable, list and message the sprite uses must be declared at the top,
including globals made by another sprite. A declared name that does not exist
yet is created.

## Scripts

Scripts are separated by a blank line. Each starts with a hat block and has a
body in braces. Statements end with a semicolon.

    whenGreenFlagClicked {
      goToXY(0, 0);
      speed = 5;
      score += 1;
      forever {
        if (keyPressed("right arrow")) {
          changeX(speed);
        } else {
          changeX(0 - speed);
        }
      }
    }

    whenIReceive(gameOver) {
      sayFor("Ouch!", 2);
      stop("all");
    }

    whenKeyPressed("space") {
      jump(10);
    }

    define fast jump(height) {
      repeat (height) {
        changeY(1);
      }
    }

speed = 5 is "set speed to 5"; score += 1 is "change score by 1".
Other hats: whenThisSpriteClicked, whenStageClicked, whenIStartAsAClone,
whenBackdropSwitchesTo("level 2"), whenGreaterThan("timer", 10).

## Values

- Numbers 5, -1.5; text in double quotes "hello"; variables by name.
- Arithmetic: + - * / %. Comparison: == < >. Logic: && || !
- There is no != or >= or <=. Write !(a == b), !(a < b), !(a > b).
- There is no "else if": put a new if inside the else.
- A reporter (round block) cannot stand on its own line, and cannot go in a
  boolean (pointed) slot: compare it instead, e.g. if (n > 0).
- Dropdowns are strings with Scratch's own values:
  touching("_edge_"), touching("_mouse_"), goTo("_random_"),
  createCloneOf("_myself_"), pointTowards("_mouse_"), stop("this script"),
  stop("other scripts in sprite"), setEffect("ghost", 50), goToLayer("front"),
  mathOp("abs", n), propertyOf("x position", "Player").
- Messages are names, not strings: broadcast(gameOver), whenIReceive(gameOver).
- isTurboWarp() is true in TurboWarp and Flipwarp and false on Scratch;
  isCompiled() is true when the compiler runs it. Use them as conditions:
  if (!isTurboWarp()) { ... }.

## Custom blocks

    define fast jump(height) {
      repeat (height) {
        changeY(1);
      }
    }

    define checkAmount(flag, n) as "check %b amount %s" {
      if (flag) {
        say(n);
      }
    }

"fast" means run without screen refresh, which games want for anything that
loops. In the label after "as", %s is a number or text slot and %b a boolean
slot. Call them like any block: jump(10); checkAmount(mouseDown(), 3);
The name in the text is made from the block's label, so read the sprite back
after writing if you used "as".

## Comments

Comments are whole lines starting with #, never at the end of a line. A # line
directly above a block becomes that block's comment. A # line with a
blank line after it is a loose comment on the canvas.

## Extensions

Extension blocks have the extension's name in front: pen.penDown(),
pen.setPenColorTo("#ff0000"), music.playDrumForBeats("1", 0.25).
Scratch's and Flipwarp's own extensions are loaded automatically when you use
them. Flipwarp's own: saveSlots, replay, dialogue, near, route (pathfinding),
tiles (tilemap), access (accessibility).
Blocks from other extensions (TurboWarp gallery, PenguinMod, URLs) only have a
text form while "otherExtensionText" is on (set_extension_text) and the
extension is loaded in the project.

## Drawing sprites

Never draw blind. The loop is: draw, look, fix.

1. preview_drawing with your svg or pixels. Look at the picture.
2. Fix what is wrong and preview again, until it looks right.
3. add_costume (or create_sprite) to put it in. Each answers with a picture.
4. replace_costume to redraw one later; it keeps the name and number, so
   switchCostume("walk2") in the scripts still works.
5. costume_sheet to see all of a sprite's frames side by side; screenshot to
   see them on the stage with everything else.

Two ways to draw:

- svg: smooth shapes that stay sharp at any size. Set width and height to
  the size you want on the stage at size 100 (the stage is 480x360; a player
  is usually 30 to 60 steps tall). Draw centred: the middle of the drawing is
  where the sprite turns. Use a dark outline (stroke) so it reads against any
  backdrop, and only a few colours.
- pixels: retro pixel art as text. A palette of single characters and rows
  of them, every row the same width, "." see-through:
  {"palette": {"k": "#1a1a2e", "b": "#3a86ff", "w": "#ffffff"},
   "rows": ["..kkkk..", ".kbbbbk.", "kbwbbwbk", "kbbbbbbk", ".kbbbbk.", "..kkkk.."],
   "scale": 4}
  16x16 or 32x32 at scale 2 to 4 is the usual size. Outline in the darkest
  colour, light from the top left, 3 to 6 colours.

Making sprites look good:

- Draw characters facing right. Direction 90 is right in Scratch, so
  pointInDirection and turning work without flipping by hand.
- Animation frames must line up: the same width, height and centre in every
  frame. Copy the previous frame and change only what moves (legs, arms).
- Keep one palette across the whole game, so sprites look like they belong.
- Backdrops are costumes of the Stage: add_costume with sprite "Stage", 480x360.
- After drawing, screenshot the stage: a sprite that looks fine alone can be
  too small, too big, or the wrong colour against its backdrop.

## Playing and testing

Writing a game is half the job; playing it is the other half. After writing:

- green_flag starts it. play runs a whole sequence in one call, the way a
  person plays: green_flag, hold "right arrow", wait 1000, press "space",
  wait 400, screenshot, release, state.
- screenshot shows the stage at 480x360: pixel (px, py) is Scratch
  x = px - 240, y = 180 - py. grid: true labels the coordinates.
- get_state gives every sprite's x, y, costume, size, speech bubble and
  variables, clones, global variables, the timer and any question asked.
  Numbers from get_state are exact; use them to check what a picture suggests.
- pause, then step_frames, to check movement one frame at a time. step_frames
  runs exact frames at full speed even when the editor tab is hidden (a hidden
  tab otherwise runs the game at about one frame a second), so it is the most
  reliable way to test: hold a key, step_frames 30, get_state, release.
- click and move_mouse use Scratch coordinates. answer_question answers ask().
- get_logs shows errors the page printed, such as a script that could not run.
- Key names are the ones keyPressed uses: "space", "up arrow", "a".

Test what the game should do: does the player stop at the wall, does the
score go up when the coin is touched, does game over show? Fix and play again.

## Working well

- Call project_overview first, then read_sprite before changing a sprite.
- Use check_text to try text without changing anything.
- After write_sprite, run health_check: it finds broadcasts nobody receives,
  scripts with no hat, variables nothing uses.
- If a write went wrong, undo puts the sprite back.
- Use text_reference with a search word to find the exact name of a block.

## Build it the way a Scratcher would

People open these projects in Scratch and remix them, so build them the way
a good Scratcher does. That is also what runs fastest.
- Menus, buttons, titles, the HUD and intros are sprites with costumes,
  shown and hidden, on backdrops. A button uses whenThisSpriteClicked.
- Players, enemies, bullets and coins are sprites and clones that move
  themselves.
- The pen is for 3D, lines and trails, and tile maps, and only redraws when
  something changed.
- Use one sprite per thing, short custom blocks, readable names (playerSpeed,
  not ps) and touching for hits.
- Mark a custom block fast only when it loops over a lot of work in one frame.
- Keep to tens of costumes per sprite and comment each sprite.
health_check points out where a project does otherwise.
`;
