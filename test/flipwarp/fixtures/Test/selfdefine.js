// Defines its own field types and then reads them back, the way More Fields
// does. Before the checker learned to only count reads that came back with
// nothing, this looked like seven things the editor was missing.
(function (Scratch) {
  Scratch.ArgumentType.MADEUPFIELD = 'MadeUpField';
  Scratch.ArgumentType.OTHERFIELD = 'OtherField';
  const a = Scratch.ArgumentType.MADEUPFIELD;
  const b = Scratch.ArgumentType.OTHERFIELD;
  class S { getInfo () { return {id: 'selfdefine', name: 'Self Define', blocks: [
    {opcode: 'x', blockType: Scratch.BlockType.REPORTER, text: 'x [A] [B]',
     arguments: {A: {type: a}, B: {type: b}}}
  ]}; } x () { return ''; } }
  Scratch.extensions.register(new S());
})(Scratch);
