# To add to flipwarp-mcp

## Being built

- **Sounds**: make game sound effects (jump, coin, hit, laser, explosion,
  power-up, win, lose...) and add them to sprites; list, rename, delete and
  play them.
- **Speed report**: real frame time, which scripts take the time, drawing,
  clones, scripts that spin, so a laggy game can be fixed, not guessed at.

## Next

- **Change one part of a sprite**: add or replace just a few custom blocks
  without rewriting the whole sprite. This caused the most bugs.

## To add

1. **No timeouts on huge sprites**: reading or searching a 5,000-block sprite
   should not freeze the editor.
2. **Smaller answers**: short replies from `load_project`, `read_sprite` by
   part, and `get_state` for chosen variables only.
3. **Run a block directly**: for example `call_block("Menu", "loadCode", code)`
   for testing, instead of special command variables.
4. **Run until something happens**: "step until `gameState` is `replay`, at
   most 300 frames".
5. **One-step saving**: clear test data, keep the TurboWarp settings and
   controller comments, save the readable `-source` copy and build the
   obfuscated copy.
6. **Scratch-safety check**: catch TurboWarp-only blocks that are not behind
   `isTurboWarp()`, cloud messages that are too long, and files too big for
   the Scratch website.
7. **Fix the blank menus after loading**: menus that only appear after stop +
   green flag.
8. **Rewind during play**: save a moment in a running game (like just before
   a goal) and jump back to it. Different from checkpoints, which save the
   project before a change.
9. **Compare two versions**: what changed between two saves, by sprite and
   custom block.
10. **`find` with context**: which custom block a match is in, plus nearby
    lines.
11. **Controller test helpers**: send controller buttons, triggers and sticks.
12. **Text-language extras**: `<=`, `>=` and `else if`, and using global names
    without declaring them again in helper sprites.
13. **3D models to costumes**: turn a model into the 24 × 7 direction costume
    set with the right centres.
14. **Filmstrip**: run the game for a moment and get several frames in one
    picture, to check animation and movement.
15. **Checkpoints**: save the whole project in memory before a risky change
    and go back to it.
16. **Saved play tests**: keep a game's test steps in the project and rerun
    them all after every change.
17. **Player 2 for online games**: drive a second editor tab as the other
    player, to test co-op games for real.
18. **Export to a web page**: turn a game into one HTML file to share or put
    online.
