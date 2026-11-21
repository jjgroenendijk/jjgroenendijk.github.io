// Architecture rules. Imports point down the layer stack only:
// main.js and controls.js, then render/, then scene/ and shaders/, then world/, then core/.
// Audio/ and debug/ are leaves used by main.js. Known violations live in .dependency-cruiser-known-violations.json
// and may only shrink.
const layer = (name, mayNotImport) => ({
  comment: `src/${name} sits below ${mayNotImport} in the layer stack`,
  from: { path: `^src/${name}/` },
  name: `no-${name}-to-${mayNotImport.replaceAll('|', '-')}`,
  severity: 'error',
  to: { path: `^src/(${mayNotImport})/` },
});

module.exports = {
  forbidden: [
    { from: {}, name: 'no-circular', severity: 'error', to: { circular: true } },
    {
      from: { orphan: true, pathNot: [String.raw`\.config\.js$`, String.raw`^\.dependency-cruiser\.cjs$`] },
      name: 'no-orphans',
      severity: 'error',
      to: {},
    },
    { from: { path: '^src/' }, name: 'no-outside-src', severity: 'error', to: { pathNot: '^src/' } },
    layer('core', 'world|scene|shaders|render|audio|debug'),
    layer('world', 'scene|shaders|render|audio|debug'),
    layer('scene', 'shaders|render|audio|debug'),
    layer('shaders', 'scene|render|audio|debug'),
    layer('render', 'audio|debug'),
    layer('audio', 'core|world|scene|shaders|render|debug'),
    layer('debug', 'world|scene|shaders|render|audio'),
    {
      from: { path: '^src/', pathNot: String.raw`^src/main\.js$` },
      name: 'only-main-uses-leaves',
      severity: 'error',
      to: { path: '^src/(audio|debug)/' },
    },
  ],
  options: { doNotFollow: { path: 'node_modules' } },
};
