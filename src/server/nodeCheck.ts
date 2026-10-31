// Imported first by index.ts so the version check runs before anything else.
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`rackdocs needs Node 20 or newer; you are running ${process.version}`);
  process.exit(1);
}
export {};
