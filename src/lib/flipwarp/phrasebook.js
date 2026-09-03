// The phrasebook: one text form per Scratch block, in both directions.
//
// Design rules (these are what make the round trip lossless):
//   1. Every block has exactly ONE text form.
//   2. Every text form maps back to exactly ONE block.
//   3. Nothing outside this table is legal text. Unknown input is an error
//      with a hint, never a guess.
//
// kind:      statement | c | terminal | hat | reporter | boolean
// name:      the identifier used in text
// args:      block input/field names, in the order they appear in the text
// fields:    which of those args are dropdown FIELDS (serialized as fields,
//            not inputs) — they always render as string literals
// substack:  statement input names, rendered as { } bodies
// infix:     operator symbol, for blocks written as infix instead of a call

import {EXTENSION_BLOCKS} from './extension-blocks.js';

const CORE_BLOCKS = {
  // ---------------------------------------------------------------- motion
  motion_movesteps:        { kind: 'statement', name: 'move', args: ['STEPS'] },
  motion_turnright:        { kind: 'statement', name: 'turnRight', args: ['DEGREES'] },
  motion_turnleft:         { kind: 'statement', name: 'turnLeft', args: ['DEGREES'] },
  motion_goto:             { kind: 'statement', name: 'goTo', args: ['TO'], menu: { TO: 'motion_goto_menu' } },
  motion_gotoxy:           { kind: 'statement', name: 'goToXY', args: ['X', 'Y'] },
  motion_glideto:          { kind: 'statement', name: 'glideTo', args: ['SECS', 'TO'], menu: { TO: 'motion_glideto_menu' } },
  motion_glidesecstoxy:    { kind: 'statement', name: 'glideToXY', args: ['SECS', 'X', 'Y'] },
  motion_pointindirection: { kind: 'statement', name: 'pointInDirection', args: ['DIRECTION'] },
  motion_pointtowards:     { kind: 'statement', name: 'pointTowards', args: ['TOWARDS'], menu: { TOWARDS: 'motion_pointtowards_menu' } },
  motion_changexby:        { kind: 'statement', name: 'changeX', args: ['DX'] },
  motion_setx:             { kind: 'statement', name: 'setX', args: ['X'] },
  motion_changeyby:        { kind: 'statement', name: 'changeY', args: ['DY'] },
  motion_sety:             { kind: 'statement', name: 'setY', args: ['Y'] },
  motion_ifonedgebounce:   { kind: 'statement', name: 'ifOnEdgeBounce', args: [] },
  motion_setrotationstyle: { kind: 'statement', name: 'setRotationStyle', args: ['STYLE'], fields: ['STYLE'] },
  motion_xposition:        { kind: 'reporter', name: 'xPosition', args: [] },
  motion_yposition:        { kind: 'reporter', name: 'yPosition', args: [] },
  motion_direction:        { kind: 'reporter', name: 'direction', args: [] },
  // hidden / legacy scrolling blocks, kept so old projects survive the round trip
  motion_scroll_right:     { kind: 'statement', name: 'scrollRight', args: ['DISTANCE'], hidden: true },
  motion_scroll_up:        { kind: 'statement', name: 'scrollUp', args: ['DISTANCE'], hidden: true },
  motion_align_scene:      { kind: 'statement', name: 'alignScene', args: ['ALIGNMENT'], fields: ['ALIGNMENT'], hidden: true },
  motion_xscroll:          { kind: 'reporter', name: 'xScroll', args: [], hidden: true },
  motion_yscroll:          { kind: 'reporter', name: 'yScroll', args: [], hidden: true },

  // ----------------------------------------------------------------- looks
  looks_sayforsecs:            { kind: 'statement', name: 'sayFor', args: ['MESSAGE', 'SECS'] },
  looks_say:                   { kind: 'statement', name: 'say', args: ['MESSAGE'] },
  looks_thinkforsecs:          { kind: 'statement', name: 'thinkFor', args: ['MESSAGE', 'SECS'] },
  looks_think:                 { kind: 'statement', name: 'think', args: ['MESSAGE'] },
  looks_switchcostumeto:       { kind: 'statement', name: 'switchCostume', args: ['COSTUME'], menu: { COSTUME: 'looks_costume' } },
  looks_nextcostume:           { kind: 'statement', name: 'nextCostume', args: [] },
  looks_switchbackdropto:      { kind: 'statement', name: 'switchBackdrop', args: ['BACKDROP'], menu: { BACKDROP: 'looks_backdrops' } },
  looks_switchbackdroptoandwait: { kind: 'statement', name: 'switchBackdropAndWait', args: ['BACKDROP'], menu: { BACKDROP: 'looks_backdrops' } },
  looks_nextbackdrop:          { kind: 'statement', name: 'nextBackdrop', args: [] },
  looks_changesizeby:          { kind: 'statement', name: 'changeSize', args: ['CHANGE'] },
  looks_setsizeto:             { kind: 'statement', name: 'setSize', args: ['SIZE'] },
  looks_changeeffectby:        { kind: 'statement', name: 'changeEffect', args: ['EFFECT', 'CHANGE'], fields: ['EFFECT'] },
  looks_seteffectto:           { kind: 'statement', name: 'setEffect', args: ['EFFECT', 'VALUE'], fields: ['EFFECT'] },
  looks_cleargraphiceffects:   { kind: 'statement', name: 'clearGraphicEffects', args: [] },
  looks_show:                  { kind: 'statement', name: 'show', args: [] },
  looks_hide:                  { kind: 'statement', name: 'hide', args: [] },
  looks_gotofrontback:         { kind: 'statement', name: 'goToLayer', args: ['FRONT_BACK'], fields: ['FRONT_BACK'] },
  looks_goforwardbackwardlayers: { kind: 'statement', name: 'changeLayer', args: ['FORWARD_BACKWARD', 'NUM'], fields: ['FORWARD_BACKWARD'] },
  looks_costumenumbername:     { kind: 'reporter', name: 'costume', args: ['NUMBER_NAME'], fields: ['NUMBER_NAME'] },
  looks_backdropnumbername:    { kind: 'reporter', name: 'backdrop', args: ['NUMBER_NAME'], fields: ['NUMBER_NAME'] },
  looks_size:                  { kind: 'reporter', name: 'size', args: [] },
  // hidden / legacy blocks, kept so old projects survive the round trip
  looks_hideallsprites:        { kind: 'statement', name: 'hideAllSprites', args: [], hidden: true },
  looks_changestretchby:       { kind: 'statement', name: 'changeStretch', args: ['CHANGE'], hidden: true },
  looks_setstretchto:          { kind: 'statement', name: 'setStretch', args: ['STRETCH'], hidden: true },

  // ----------------------------------------------------------------- sound
  sound_play:            { kind: 'statement', name: 'startSound', args: ['SOUND_MENU'], menu: { SOUND_MENU: 'sound_sounds_menu' } },
  sound_playuntildone:   { kind: 'statement', name: 'playSoundUntilDone', args: ['SOUND_MENU'], menu: { SOUND_MENU: 'sound_sounds_menu' } },
  sound_stopallsounds:   { kind: 'statement', name: 'stopAllSounds', args: [] },
  sound_changeeffectby:  { kind: 'statement', name: 'changeSoundEffect', args: ['EFFECT', 'VALUE'], fields: ['EFFECT'] },
  sound_seteffectto:     { kind: 'statement', name: 'setSoundEffect', args: ['EFFECT', 'VALUE'], fields: ['EFFECT'] },
  sound_cleareffects:    { kind: 'statement', name: 'clearSoundEffects', args: [] },
  sound_changevolumeby:  { kind: 'statement', name: 'changeVolume', args: ['VOLUME'] },
  sound_setvolumeto:     { kind: 'statement', name: 'setVolume', args: ['VOLUME'] },
  sound_volume:          { kind: 'reporter', name: 'volume', args: [] },

  // ---------------------------------------------------------------- events
  event_whenflagclicked:       { kind: 'hat', name: 'whenGreenFlagClicked', args: [] },
  event_whenkeypressed:        { kind: 'hat', name: 'whenKeyPressed', args: ['KEY_OPTION'], fields: ['KEY_OPTION'] },
  event_whenthisspriteclicked: { kind: 'hat', name: 'whenThisSpriteClicked', args: [] },
  event_whenstageclicked:      { kind: 'hat', name: 'whenStageClicked', args: [] },
  event_whenbackdropswitchesto:{ kind: 'hat', name: 'whenBackdropSwitchesTo', args: ['BACKDROP'], fields: ['BACKDROP'] },
  event_whengreaterthan:       { kind: 'hat', name: 'whenGreaterThan', args: ['WHENGREATERTHANMENU', 'VALUE'], fields: ['WHENGREATERTHANMENU'] },
  event_whenbroadcastreceived: { kind: 'hat', name: 'whenIReceive', args: ['BROADCAST_OPTION'], fields: ['BROADCAST_OPTION'], broadcastField: 'BROADCAST_OPTION' },
  event_broadcast:             { kind: 'statement', name: 'broadcast', args: ['BROADCAST_INPUT'], menu: { BROADCAST_INPUT: 'event_broadcast_menu' } },
  event_broadcastandwait:      { kind: 'statement', name: 'broadcastAndWait', args: ['BROADCAST_INPUT'], menu: { BROADCAST_INPUT: 'event_broadcast_menu' } },
  event_whentouchingobject:    { kind: 'hat', name: 'whenTouching', args: ['TOUCHINGOBJECTMENU'], menu: { TOUCHINGOBJECTMENU: 'event_touchingobjectmenu' }, hidden: true },

  // --------------------------------------------------------------- control
  control_wait:             { kind: 'statement', name: 'wait', args: ['DURATION'] },
  control_repeat:           { kind: 'c', name: 'repeat', args: ['TIMES'], substack: ['SUBSTACK'] },
  control_forever:          { kind: 'c', name: 'forever', args: [], substack: ['SUBSTACK'], terminal: true },
  control_if:               { kind: 'c', name: 'if', args: ['CONDITION'], substack: ['SUBSTACK'], syntax: 'if' },
  control_if_else:          { kind: 'c', name: 'ifElse', args: ['CONDITION'], substack: ['SUBSTACK', 'SUBSTACK2'], syntax: 'ifElse' },
  control_wait_until:       { kind: 'statement', name: 'waitUntil', args: ['CONDITION'] },
  control_repeat_until:     { kind: 'c', name: 'repeatUntil', args: ['CONDITION'], substack: ['SUBSTACK'] },
  control_while:            { kind: 'c', name: 'while', args: ['CONDITION'], substack: ['SUBSTACK'], hidden: true },
  control_for_each:         { kind: 'c', name: 'forEach', args: ['VARIABLE', 'VALUE'], fields: ['VARIABLE'], substack: ['SUBSTACK'], hidden: true },
  control_stop:             { kind: 'statement', name: 'stop', args: ['STOP_OPTION'], fields: ['STOP_OPTION'], dynamicTerminal: true },
  control_start_as_clone:   { kind: 'hat', name: 'whenIStartAsAClone', args: [] },
  control_create_clone_of:  { kind: 'statement', name: 'createCloneOf', args: ['CLONE_OPTION'], menu: { CLONE_OPTION: 'control_create_clone_of_menu' } },
  control_delete_this_clone:{ kind: 'terminal', name: 'deleteThisClone', args: [] },
  control_all_at_once:      { kind: 'c', name: 'allAtOnce', args: [], substack: ['SUBSTACK'], hidden: true },
  control_incr_counter:     { kind: 'statement', name: 'incrementCounter', args: [], hidden: true },
  control_clear_counter:    { kind: 'statement', name: 'clearCounter', args: [], hidden: true },
  control_get_counter:      { kind: 'reporter', name: 'counter', args: [], hidden: true },

  // --------------------------------------------------------------- sensing
  sensing_touchingobject:      { kind: 'boolean', name: 'touching', args: ['TOUCHINGOBJECTMENU'], menu: { TOUCHINGOBJECTMENU: 'sensing_touchingobjectmenu' } },
  sensing_touchingcolor:       { kind: 'boolean', name: 'touchingColor', args: ['COLOR'] },
  sensing_coloristouchingcolor:{ kind: 'boolean', name: 'colorIsTouchingColor', args: ['COLOR', 'COLOR2'] },
  sensing_distanceto:          { kind: 'reporter', name: 'distanceTo', args: ['DISTANCETOMENU'], menu: { DISTANCETOMENU: 'sensing_distancetomenu' } },
  sensing_askandwait:          { kind: 'statement', name: 'askAndWait', args: ['QUESTION'] },
  sensing_answer:              { kind: 'reporter', name: 'answer', args: [] },
  sensing_keypressed:          { kind: 'boolean', name: 'keyPressed', args: ['KEY_OPTION'], menu: { KEY_OPTION: 'sensing_keyoptions' } },
  sensing_mousedown:           { kind: 'boolean', name: 'mouseDown', args: [] },
  sensing_mousex:              { kind: 'reporter', name: 'mouseX', args: [] },
  sensing_mousey:              { kind: 'reporter', name: 'mouseY', args: [] },
  sensing_setdragmode:         { kind: 'statement', name: 'setDragMode', args: ['DRAG_MODE'], fields: ['DRAG_MODE'] },
  sensing_loudness:            { kind: 'reporter', name: 'loudness', args: [] },
  sensing_timer:               { kind: 'reporter', name: 'timer', args: [] },
  sensing_resettimer:          { kind: 'statement', name: 'resetTimer', args: [] },
  sensing_of:                  { kind: 'reporter', name: 'propertyOf', args: ['PROPERTY', 'OBJECT'], fields: ['PROPERTY'], menu: { OBJECT: 'sensing_of_object_menu' } },
  sensing_current:             { kind: 'reporter', name: 'current', args: ['CURRENTMENU'], fields: ['CURRENTMENU'] },
  sensing_dayssince2000:       { kind: 'reporter', name: 'daysSince2000', args: [] },
  sensing_username:            { kind: 'reporter', name: 'username', args: [] },
  sensing_online:              { kind: 'boolean', name: 'online', args: [], hidden: true },
  sensing_loud:                { kind: 'boolean', name: 'loud', args: [], hidden: true },
  sensing_userid:              { kind: 'reporter', name: 'userId', args: [], hidden: true },

  // ------------------------------------------------------------- operators
  operator_add:      { kind: 'reporter', name: 'add', args: ['NUM1', 'NUM2'], infix: '+', prec: 6 },
  operator_subtract: { kind: 'reporter', name: 'sub', args: ['NUM1', 'NUM2'], infix: '-', prec: 6 },
  operator_multiply: { kind: 'reporter', name: 'mul', args: ['NUM1', 'NUM2'], infix: '*', prec: 7 },
  operator_divide:   { kind: 'reporter', name: 'div', args: ['NUM1', 'NUM2'], infix: '/', prec: 7 },
  operator_random:   { kind: 'reporter', name: 'pickRandom', args: ['FROM', 'TO'] },
  operator_gt:       { kind: 'boolean', name: 'gt', args: ['OPERAND1', 'OPERAND2'], infix: '>', prec: 4 },
  operator_lt:       { kind: 'boolean', name: 'lt', args: ['OPERAND1', 'OPERAND2'], infix: '<', prec: 4 },
  operator_equals:   { kind: 'boolean', name: 'eq', args: ['OPERAND1', 'OPERAND2'], infix: '==', prec: 3 },
  operator_and:      { kind: 'boolean', name: 'and', args: ['OPERAND1', 'OPERAND2'], infix: '&&', prec: 2 },
  operator_or:       { kind: 'boolean', name: 'or', args: ['OPERAND1', 'OPERAND2'], infix: '||', prec: 1 },
  operator_not:      { kind: 'boolean', name: 'not', args: ['OPERAND'], prefix: '!', prec: 8 },
  operator_join:     { kind: 'reporter', name: 'join', args: ['STRING1', 'STRING2'] },
  operator_letter_of:{ kind: 'reporter', name: 'letterOf', args: ['LETTER', 'STRING'] },
  operator_length:   { kind: 'reporter', name: 'lengthOf', args: ['STRING'] },
  operator_contains: { kind: 'boolean', name: 'contains', args: ['STRING1', 'STRING2'] },
  operator_mod:      { kind: 'reporter', name: 'mod', args: ['NUM1', 'NUM2'], infix: '%', prec: 7 },
  operator_round:    { kind: 'reporter', name: 'round', args: ['NUM'] },
  operator_mathop:   { kind: 'reporter', name: 'mathOp', args: ['OPERATOR', 'NUM'], fields: ['OPERATOR'] },

  // ------------------------------------------------------------------ data
  data_setvariableto:    { kind: 'statement', name: 'setVar', args: ['VARIABLE', 'VALUE'], fields: ['VARIABLE'], syntax: 'assign' },
  data_changevariableby: { kind: 'statement', name: 'changeVar', args: ['VARIABLE', 'VALUE'], fields: ['VARIABLE'], syntax: 'assignAdd' },
  data_showvariable:     { kind: 'statement', name: 'showVariable', args: ['VARIABLE'], fields: ['VARIABLE'] },
  data_hidevariable:     { kind: 'statement', name: 'hideVariable', args: ['VARIABLE'], fields: ['VARIABLE'] },
  data_addtolist:        { kind: 'statement', name: 'addToList', args: ['LIST', 'ITEM'], fields: ['LIST'] },
  data_deleteoflist:     { kind: 'statement', name: 'deleteOfList', args: ['LIST', 'INDEX'], fields: ['LIST'] },
  data_deletealloflist:  { kind: 'statement', name: 'deleteAllOfList', args: ['LIST'], fields: ['LIST'] },
  data_insertatlist:     { kind: 'statement', name: 'insertInList', args: ['LIST', 'INDEX', 'ITEM'], fields: ['LIST'] },
  data_replaceitemoflist:{ kind: 'statement', name: 'replaceInList', args: ['LIST', 'INDEX', 'ITEM'], fields: ['LIST'] },
  data_itemoflist:       { kind: 'reporter', name: 'itemOfList', args: ['LIST', 'INDEX'], fields: ['LIST'] },
  data_itemnumoflist:    { kind: 'reporter', name: 'itemNumberInList', args: ['LIST', 'ITEM'], fields: ['LIST'] },
  data_lengthoflist:     { kind: 'reporter', name: 'lengthOfList', args: ['LIST'], fields: ['LIST'] },
  data_listcontainsitem: { kind: 'boolean', name: 'listContains', args: ['LIST', 'ITEM'], fields: ['LIST'] },
  data_showlist:         { kind: 'statement', name: 'showList', args: ['LIST'], fields: ['LIST'] },
  data_hidelist:         { kind: 'statement', name: 'hideList', args: ['LIST'], fields: ['LIST'] },
  data_listindexall:     { kind: 'reporter', name: 'listIndexAll', args: ['INDEX'], fields: ['INDEX'], hidden: true },
  data_listindexrandom:  { kind: 'reporter', name: 'listIndexRandom', args: ['INDEX'], fields: ['INDEX'], hidden: true },
};

// Core blocks plus every built-in extension's blocks. Extension names carry
// their extension in front (pen.penDown), so they can never collide with a
// core block.
export const BLOCKS = Object.assign({}, CORE_BLOCKS, EXTENSION_BLOCKS);

// Blocks that never stand alone: they are the dropdown inside another block's
// input slot, and are written inline as a plain string in the text form.
export const MENU_BLOCKS = new Set([
    // every extension menu, e.g. pen_menu_colorParam
    ...Object.values(EXTENSION_BLOCKS)
        .flatMap(def => Object.values(def.menu || {})),
  'motion_goto_menu', 'motion_glideto_menu', 'motion_pointtowards_menu',
  'looks_costume', 'looks_backdrops', 'sound_sounds_menu',
  'control_create_clone_of_menu', 'sensing_touchingobjectmenu',
  'sensing_distancetomenu', 'sensing_of_object_menu', 'sensing_keyoptions',
  'event_touchingobjectmenu', 'event_broadcast_menu',
]);

// Shadow blocks that carry a literal value in a slot.
export const LITERAL_SHADOWS = new Set([
  'math_number', 'math_integer', 'math_whole_number', 'math_positive_number',
  'math_angle', 'text', 'colour_picker', 'note', 'matrix',
]);

// Variable / list getters, written as a bare identifier.
export const GETTERS = { data_variable: 'VARIABLE', data_listcontents: 'LIST' };

// Custom block machinery.
export const PROCEDURE_OPCODES = new Set([
  'procedures_definition', 'procedures_prototype', 'procedures_call',
  'procedures_declaration', 'argument_reporter_string_number',
  'argument_reporter_boolean', 'argument_editor_string_number',
  'argument_editor_boolean',
]);

// Reverse index: text name -> opcode. Built once, and checked for collisions,
// because a collision would silently break the round trip.
export const BY_NAME = (() => {
  const m = new Map();
  for (const [opcode, def] of Object.entries(BLOCKS)) {
    if (m.has(def.name)) throw new Error(`phrasebook collision: "${def.name}" used by ${m.get(def.name)} and ${opcode}`);
    m.set(def.name, opcode);
  }
  return m;
})();

export const RESERVED = new Set([
  ...BY_NAME.keys(),
  'if', 'else', 'repeat', 'forever', 'while', 'define', 'true', 'false',
]);
