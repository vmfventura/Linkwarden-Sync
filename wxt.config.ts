import { defineConfig } from 'wxt';
import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  // Never launch or reuse a user's browser profile from the development watcher.
  webExt: { disabled: true },
  hooks: {
    'build:done': async wxt => {
      for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
        await copyFile(resolve(wxt.config.root, file), resolve(wxt.config.outDir, file));
      }
    },
    'zip:start': wxt => {
      // WXT excludes tests by default. Our review archive includes the regression suite.
      wxt.config.zip.excludeSources = wxt.config.zip.excludeSources.filter(pattern => pattern !== '**/*.+(test|spec).?(c|m)+(j|t)s?(x)');
    },
  },
  manifest: ({ browser }) => ({
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    ...(browser === 'chrome' ? { minimum_chrome_version: '140' } : {}),
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 96: 'icon/96.png', 128: 'icon/128.png' },
    permissions: ['storage', 'activeTab', 'alarms'],
    optional_host_permissions: ['https://*/*'],
    incognito: 'not_allowed',
    action: { default_title: '__MSG_extensionName__' },
    ...(browser === 'chrome' ? { externally_connectable: { ids: [] } } : {}),
    content_security_policy: {
      extension_pages: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    },
    ...(browser === 'firefox' ? { browser_specific_settings: {
      gecko: {
        id: 'linkwarden-sync@linkwarden-sync.local',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['authenticationInfo', 'browsingActivity'] },
      },
    } } : {}),
  }),
  zip: {
    includeSources: [
      'package.json', 'package-lock.json', 'tsconfig.json', 'wxt.config.ts', 'vitest.config.ts',
      'entrypoints/**', 'src/**', 'public/**', 'tests/**', 'scripts/**', 'demo/**',
      'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'README.md', 'PRIVACY.md', 'SECURITY.md',
      'docs/GETTING_STARTED.md', 'docs/PUBLISHING.md', 'docs/media/**',
    ],
    excludeSources: ['demo/dist/**'],
  },
});
