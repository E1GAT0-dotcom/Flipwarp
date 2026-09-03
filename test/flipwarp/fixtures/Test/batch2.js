// Uses everything the second compatibility batch added, the way the real
// gallery extensions use it. This file is loaded twice: once by the editor
// (in penguinmod-batch2's sibling test) and once by the checker page, so the
// two stay honest with each other. If the checker says this "needs more",
// the checker's stand-in has fallen behind the editor again.
(function (Scratch) {
  const vm = Scratch.vm;
  window.__batch2Probe = {
    gui: typeof Scratch.gui === 'object' && typeof Scratch.gui.getBlockly === 'function',
    variable: Scratch.ArgumentType.VARIABLE,
    output: Scratch.BlockType.OUTPUT
  };
  Scratch.gui.getBlockly().then(() => {});
  vm.runtime.registerSerializer('batch2Type', v => [v.n], v => ({n: v[0]}));
  vm.runtime.registerCompiledExtensionBlocks('batch2', {ir: {}, js: {}});
  vm.runtime.extensionManager.loadExtensionIdSync('pen');
  class B {
    getInfo () {
      return {
        id: 'batch2',
        name: 'Batch Two',
        blocks: [{
          opcode: 'setVar',
          blockType: Scratch.BlockType.COMMAND,
          text: 'set [VARIABLE] to [VALUE]',
          arguments: {
            VARIABLE: {type: Scratch.ArgumentType.VARIABLE},
            VALUE: {type: Scratch.ArgumentType.STRING, defaultValue: '0'}
          }
        }, {
          opcode: 'anon',
          blockType: Scratch.BlockType.OUTPUT,
          blockShape: Scratch.BlockShape.SQUARE,
          text: 'anonymous function'
        }]
      };
    }
    setVar () {}
    anon () { return ''; }
  }
  Scratch.extensions.register(new B());
})(Scratch);
