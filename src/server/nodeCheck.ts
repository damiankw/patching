// Imported first by index.ts so this runs before any native module is loaded.
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`rackdocs needs Node 20 or newer; you are running ${process.version}`);
  process.exit(1);
}
export {};
