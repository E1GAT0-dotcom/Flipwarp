// Sounds and the speed report, through the tools, in a real editor.
//
// Start it, then open the editor address it prints (FLIPWARP_PORT picks the
// port). Sounds: made from presets and a file, played from blocks, listed,
// renamed, deleted, mistakes refused. Speed: nothing running, a light game
// that fits its frames, and a heavy script it must name as the slow part.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {start} from './mcp-client.mjs';
import {makeSound} from '../../mcp/sounds.mjs';

const {call, check, must, finish} = await start('sound and speed test');

// --- sounds ------------------------------------------------------------------

let r = await must('add a coin sound', 'add_sound', {sprite: 'Sprite1', name: 'coin', preset: 'coin'});
check(/Added sound "coin" to Sprite1: 0\.\d+s, square, 988 Hz rising/.test(r.text), 'it is described', r.text);
r = await must('add a jump with a variation and pitch', 'add_sound',
    {sprite: 'Sprite1', name: 'jump', preset: 'jump', variation: 3, pitch: 2});
r = await must('add a custom sound', 'add_sound',
    {sprite: 'Sprite1', name: 'beep', custom: {wave: 'sine', freq: 600, sustain: 0.1, decay: 0.1}});
const file = path.join(os.tmpdir(), 'flipwarp-sound-test.wav');
fs.writeFileSync(file, makeSound({preset: 'explosion'}).wav);
r = await must('add a sound from a file', 'add_sound', {sprite: 'Stage', name: 'boom', file});
fs.rmSync(file, {force: true});
r = await must('a taken name gets a new one', 'add_sound', {sprite: 'Sprite1', name: 'coin', preset: 'coin', variation: 1});
check(/named "coin2"/.test(r.text), 'and says so', r.text);

r = await must('list the sounds', 'list_sounds', {sprite: 'Sprite1'});
const sounds = JSON.parse(r.text).sounds;
const names = sounds.map(s => s.name);
check(['coin', 'jump', 'beep', 'coin2'].every(n => names.includes(n)), 'all there', names.join(', '));
const coin = sounds.find(s => s.name === 'coin');
check(coin && coin.seconds > 0.2 && coin.seconds < 0.5, 'with its length', JSON.stringify(coin));

r = await must('play them from blocks', 'write_sprite', {sprite: 'Sprite1', text: `whenGreenFlagClicked {
  startSound("coin");
  playSoundUntilDone("jump");
}`});
await must('the game runs them', 'green_flag');
r = await call('get_logs');
check(/No errors/.test(r.text), 'with no errors', r.text);
await must('play one for the person watching', 'play_sound', {sprite: 'Sprite1', sound: 'beep'});
await must('rename one', 'rename_sound', {sprite: 'Sprite1', sound: 'coin2', name: 'gem'});
r = await must('delete one', 'delete_sound', {sprite: 'Sprite1', sound: 'gem'});
check(!JSON.parse(r.text).left.includes('gem'), 'it has gone', r.text);
r = await call('delete_sound', {sprite: 'Sprite1', sound: 'nope'});
check(r.error && /has no sound "nope"/.test(r.text), 'a missing sound is refused with the list', r.text);
r = await call('add_sound', {sprite: 'Sprite1', name: 'x', custom: {wave: 'kazoo'}});
check(r.error && /is not a wave/.test(r.text), 'a wrong recipe is refused', r.text);
await call('stop');

// --- speed -------------------------------------------------------------------

r = await must('speed with nothing running', 'speed_report', {});
check(/Nothing is running/.test(r.text), 'says so', r.text);

await must('a light game', 'write_sprite', {sprite: 'Sprite1', text: `whenGreenFlagClicked {
  forever {
    turnRight(1);
  }
}`});
await must('start it', 'green_flag');
r = await must('speed of a light game', 'speed_report', {frames: 30});
check(/^Fast enough/.test(r.text), 'it fits its frames', r.text);

await must('a heavy game', 'write_sprite', {sprite: 'Sprite1', text: `global variable n;

whenGreenFlagClicked {
  forever {
    heavy();
    turnRight(1);
  }
}

define fast heavy() {
  repeat (8000000) {
    n += 1;
  }
}`});
await must('start it', 'green_flag');
r = await must('speed of a heavy game', 'speed_report', {frames: 20});
check(/^TOO SLOW/.test(r.text), 'it is too slow', r.text);
const listed = [...r.text.matchAll(/^- (.+?): (.+?): ([\d.]+)ms \((\d+)%\)/gm)];
check(listed.length && listed[0][1] === 'Sprite1' && Number(listed[0][4]) > 30,
    'the slow script is named first, with a big share of the time', r.text);
check(/Each frame: scripts [\d.]+ms, .*the editor showing changes/.test(r.text), 'with where the rest went', r.text);
check(/Start with Sprite1/.test(r.text), 'and it says where to start', r.text);
r = await call('get_state');
check(!JSON.parse(r.text).frozen, 'the game is left running as it was', r.text.slice(0, 200));
await call('stop');

await finish('sound and speed: all passed');
