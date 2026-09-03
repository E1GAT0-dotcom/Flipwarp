// Which shadow (the little grey slot behind an input) each block input uses.
// Mostly extracted from scratch-gui's toolbox; the rest are the ones the
// toolbox builds dynamically, filled in here.
import extracted from './input-shadows-data.js';
import {EXTENSION_INPUT_SHADOWS} from './extension-blocks.js';

const NONE = null; // boolean slots have no shadow at all

const OVERRIDES = {
  motion_gotoxy:          { X: 'math_number', Y: 'math_number' },
  motion_glidesecstoxy:   { X: 'math_number', Y: 'math_number' },
  motion_setx:            { X: 'math_number' },
  motion_sety:            { Y: 'math_number' },
  motion_scroll_right:    { DISTANCE: 'math_number' },
  motion_scroll_up:       { DISTANCE: 'math_number' },
  looks_changestretchby:  { CHANGE: 'math_number' },
  looks_setstretchto:     { STRETCH: 'math_number' },
  control_if:             { CONDITION: NONE },
  control_if_else:        { CONDITION: NONE },
  control_wait_until:     { CONDITION: NONE },
  control_repeat_until:   { CONDITION: NONE },
  control_while:          { CONDITION: NONE },
  control_for_each:       { VALUE: 'math_whole_number' },
  operator_and:           { OPERAND1: NONE, OPERAND2: NONE },
  operator_or:            { OPERAND1: NONE, OPERAND2: NONE },
  operator_not:           { OPERAND: NONE },
  data_setvariableto:     { VALUE: 'text' },
  data_changevariableby:  { VALUE: 'math_number' },
  data_addtolist:         { ITEM: 'text' },
  data_deleteoflist:      { INDEX: 'math_integer' },
  data_insertatlist:      { INDEX: 'math_integer', ITEM: 'text' },
  data_replaceitemoflist: { INDEX: 'math_integer', ITEM: 'text' },
  data_itemoflist:        { INDEX: 'math_integer' },
  data_itemnumoflist:     { ITEM: 'text' },
  data_listcontainsitem:  { ITEM: 'text' },
};

export const INPUT_SHADOWS = (() => {
  const m = {};
  for (const [op, inputs] of Object.entries(extracted)) m[op] = { ...inputs };
  for (const [op, inputs] of Object.entries(EXTENSION_INPUT_SHADOWS)) m[op] = { ...(m[op] || {}), ...inputs };
  for (const [op, inputs] of Object.entries(OVERRIDES)) m[op] = { ...(m[op] || {}), ...inputs };
  return m;
})();

// shadow opcode -> [primitive type code, field name]
export const SHADOW_PRIMITIVE = {
  math_number: [4, 'NUM'],
  math_positive_number: [5, 'NUM'],
  math_whole_number: [6, 'NUM'],
  math_integer: [7, 'NUM'],
  math_angle: [8, 'NUM'],
  colour_picker: [9, 'COLOUR'],
  text: [10, 'TEXT'],
};

export function shadowFor(opcode, inputName) {
  const s = INPUT_SHADOWS[opcode];
  if (!s || !(inputName in s)) return 'text';
  return s[inputName];
}

export function primitiveFor(opcode, inputName) {
  const shadow = shadowFor(opcode, inputName);
  if (!shadow) return null;
  return SHADOW_PRIMITIVE[shadow] || [10, 'TEXT'];
}
