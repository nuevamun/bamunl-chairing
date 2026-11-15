import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',
  adapter: vercel(),
  security: { checkOrigin: true },
  // Scripts must be files, never inlined, so the CSP in vercel.json can forbid inline script.
  vite: {
    build: { assetsInlineLimit: 0 },
    // Which deploy this code came from, so an open tab can tell when a newer one is out.
    define: { __BUILD__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || 'dev') },
  },
});
