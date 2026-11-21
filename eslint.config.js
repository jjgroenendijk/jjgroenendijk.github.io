// Strictest practical ESLint setup: every core rule and every unicorn rule, sonarjs on top, and only the stylistic
// rules that fight Prettier switched off. Violations that predate this setup are recorded in
// eslint-suppressions.json; that baseline may only shrink (`npm run lint:prune` after fixing some).
import globals from 'globals';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';

// Globals the CPU-side world layer must not touch.
const BROWSER_AND_GPU_GLOBALS = [
    'window',
    'document',
    'navigator',
    'location',
    'GPUBufferUsage',
    'GPUTextureUsage',
    'GPUShaderStage',
    'GPUMapMode',
  ],
  // Clean-code limits; architecture rules live in .dependency-cruiser.cjs.
  LIMITS = {
    cognitive: 15,
    complexity: 10,
    depth: 3,
    fileLines: 400,
    functionLines: 60,
    nestedCallbacks: 3,
    params: 4,
    statements: 15,
  },
  // Short names are the house style in vector, noise and shader-adjacent maths.
  MATH_NAMES = [...'abcdefghijkmnpqrstuvwxyz_'];

export default [
  { ignores: ['node_modules/', '_site/', 'public/', 'themes/'] },
  js.configs.all,
  unicorn.configs.all,
  sonarjs.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', globals: { ...globals.browser }, sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' },
    rules: {
      // A comment that wraps onto further lines is one sentence: only its first line starts with a capital.
      'capitalized-comments': ['error', 'always', { ignoreConsecutiveComments: true }],
      complexity: ['error', LIMITS.complexity],
      'id-length': ['error', { exceptions: MATH_NAMES, min: 2, properties: 'never' }],
      'max-depth': ['error', LIMITS.depth],
      'max-lines': ['error', { max: LIMITS.fileLines, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: LIMITS.functionLines, skipBlankLines: true, skipComments: true }],
      'max-nested-callbacks': ['error', LIMITS.nestedCallbacks],
      'max-params': ['error', LIMITS.params],
      'max-statements': ['error', LIMITS.statements],
      'sonarjs/cognitive-complexity': ['error', LIMITS.cognitive],
      // Contradicts the core arrow-body-style rule, which forbids the block body this one demands for multi-line
      // returns; the core rule stays.
      'unicorn/consistent-arrow-return-style': 'off',
    },
  },
  {
    // The world layer and the math helpers run on the CPU next to the camera director: keep them free of browser and
    // GPU APIs so they stay portable and testable.
    files: ['src/world/**/*.js', 'src/core/math.js'],
    rules: { 'no-restricted-globals': ['error', ...BROWSER_AND_GPU_GLOBALS] },
  },
  {
    // Shader modules are mostly WGSL template strings, which are data rather than JS logic.
    files: ['src/shaders/**/*.js'],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
  },
  {
    files: ['*.config.js', '.*.cjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Last: switches off only the stylistic rules that would fight Prettier.
  prettier,
];
