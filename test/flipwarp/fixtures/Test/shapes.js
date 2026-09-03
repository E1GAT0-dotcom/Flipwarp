// Uses the PenguinMod-only shapes and menu types the gallery report flagged.
// If the compatibility layer is doing its job, this loads and every value
// below comes back defined.
(function (Scratch) {
  window.__shapeProbe = {
    LEAF: Scratch.BlockShape.LEAF,
    ARROW: Scratch.BlockShape.ARROW,
    OCTAGONAL: Scratch.BlockShape.OCTAGONAL,
    EMPTY: Scratch.ArgumentType.EMPTY,
    MenuType: Scratch.MenuType && Scratch.MenuType.DEFAULT,
    NotchShape: Scratch.NotchShape && Scratch.NotchShape.DEFAULT
  };
  class S { getInfo () { return {id: 'shapes', name: 'Shapes', blocks: [
    {opcode: 'a', blockType: Scratch.BlockType.REPORTER, blockShape: Scratch.BlockShape.LEAF, text: 'leaf'}
  ]}; } }
  Scratch.extensions.register(new S());
})(Scratch);
