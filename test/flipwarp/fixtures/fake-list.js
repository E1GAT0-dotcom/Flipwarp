export default [
  { name: "Good One", description: "loads fine", code: "Test/good.js", banner: "Test/icon.svg", creator: "Someone" },
  { name: "Needs Event", description: "uses a missing event", code: "Test/event.js", creator: "Someone" },
  { name: "Broken", description: "throws", code: "Test/broken.js", creator: "Someone" },
  { name: "Uses PM Shapes", description: "penguinmod shapes", code: "Test/shapes.js", banner: "Test/missing-icon.svg", creator: "Someone" },
  { name: "Uses Batch Two", description: "gui, serializers, extension manager", code: "Test/batch2.js", creator: "Someone" },
  { name: "Defines Its Own", description: "self-defined field types", code: "Test/selfdefine.js", creator: "Someone" },
  { name: "Missing File", description: "404", code: "Test/nope.js", creator: "Someone" }
];
