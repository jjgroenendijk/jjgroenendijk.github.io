// Architecture rules. Imports point down the layer stack only:
//   main.js, controls.js -> render/ -> scene/, shaders/ -> world/ -> core/
// audio/ and debug/ are leaves used by main.js. Known violations live in .dependency-cruiser-known-violations.json
// and may only shrink.
const layer = (name, mayNotImport) => ({
  name: `no-${name}-to-${mayNotImport.replaceAll('|', '-')}`,
  comment: `src/${name} sits below ${mayNotImport} in the layer stack`,
  severity: 'error',
  from: { path: `^src/${name}/` },
  to: { path: `^src/(${mayNotImport})/` },
});

module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'no-orphans',
      severity: 'error',
      from: { orphan: true, pathNot: ['\\.config\\.(c?js)$', '^\\.dependency-cruiser\\.cjs$'] },
      to: {},
    },
    { name: 'no-outside-src', severity: 'error', from: { path: '^src/' }, to: { pathNot: '^src/' } },
    layer('core', 'world|scene|shaders|render|audio|debug'),
    layer('world', 'scene|shaders|render|audio|debug'),
    layer('scene', 'shaders|render|audio|debug'),
    layer('shaders', 'scene|render|audio|debug'),
    layer('render', 'audio|debug'),
    layer('audio', 'core|world|scene|shaders|render|debug'),
    layer('debug', 'world|scene|shaders|render|audio'),
    {
      name: 'only-main-uses-leaves',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/main\\.js$' },
      to: { path: '^src/(audio|debug)/' },
    },
  ],
  options: { doNotFollow: { path: 'node_modules' }},
};
