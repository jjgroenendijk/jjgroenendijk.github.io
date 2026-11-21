// Strictest practical ESLint setup: every core rule, every unicorn rule and sonarjs on top, with only the rules that
// contradict another enabled rule or the formatter turned off (each with a reason). Existing violations are recorded
// in eslint-suppressions.json; that baseline may only shrink (`npm run lint:prune`).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';

// Short names are the house style in vector, noise and shader-adjacent maths.
const MATH_NAMES = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'm',
  'n',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
  '_',
];

export default [
  { ignores: ['node_modules/', '_site/', 'public/', 'themes/'] },
  js.configs.all,
  unicorn.configs.all,
  sonarjs.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } },
    linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' },
    rules: {
      // Clean-code limits (architecture checks live in .dependency-cruiser.cjs).
      complexity: ['error', 10],
      'sonarjs/cognitive-complexity': ['error', 15],
      'max-depth': ['error', 3],
      'max-params': ['error', 4],
      'max-statements': ['error', 15],
      'max-nested-callbacks': ['error', 3],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'id-length': ['error', { min: 2, exceptions: MATH_NAMES, properties: 'never' }],
    },
  },
  {
    // The world layer and the math helpers run on the CPU next to the camera director: keep them free of browser and
    // GPU APIs so they stay portable and testable.
    files: ['src/world/**/*.js', 'src/core/math.js'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'location',
        'GPUBufferUsage',
        'GPUTextureUsage',
        'GPUShaderStage',
        'GPUMapMode',
      ],
    },
  },
  {
    // Shader modules are mostly WGSL template strings, which are data rather than JS logic.
    files: ['src/shaders/**/*.js'],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
  },
  {
    files: ['*.config.js', '*.config.cjs', '.*.cjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Last: switches off only the stylistic rules that would fight Prettier.
  prettier,
];
