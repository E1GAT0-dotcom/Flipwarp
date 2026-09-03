// Stands in for an extension that reaches for things this engine lacks. It
// must still be reported in full rather than dying at the first one.
(function (Scratch) {
  Scratch.vm.runtime.on('PENGUINMOD_ONLY_EVENT', () => {});
  Scratch.somethingWeDoNotHave.doThing();
  class E { getInfo () { return { id: 'ev', name: 'Ev', blocks: [
    {opcode: 'y', blockType: Scratch.BlockType.REPORTER, text: 'y'}
  ] }; } }
  Scratch.extensions.register(new E());
})(Scratch);
