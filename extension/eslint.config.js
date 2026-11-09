import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'dist-standalone', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    // Hard rule 2: the UI never touches chrome.* (it must also run inside WebView2).
    // RuntimePortTransport is the single, deliberate exception.
    files: ['src/ui/**/*.{ts,tsx}'],
    ignores: ['src/ui/transport/runtimePort.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'UI must go through Transport.' },
      ],
    },
  },
  prettier,
);
