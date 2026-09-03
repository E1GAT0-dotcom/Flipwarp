// Stands in for an extension that needs nothing beyond what this engine has.
(function (Scratch) {
  class Good { getInfo () { return { id: 'good', name: 'Good', blocks: [
    {opcode: 'x', blockType: Scratch.BlockType.REPORTER, text: 'x'},
    {opcode: 'b', blockType: Scratch.BlockType.BUTTON, text: 'a button'}
  ] }; } }
  Scratch.extensions.register(new Good());
})(Scratch);
