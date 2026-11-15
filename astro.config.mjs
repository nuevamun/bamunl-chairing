import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',
  adapter: vercel(),
  security: { checkOrigin: true },
  // Scripts must be files, never inlined, so the CSP in vercel.json can forbid inline script.
  vite: { build: { assetsInlineLimit: 0 } },
});
