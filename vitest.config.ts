import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

/**
 * Separate from `vite.config.ts` on purpose. The app config loads the
 * SvelteKit plugin, which wants a running dev server and a `$app/*` runtime;
 * none of these tests render a component. They talk to the local Supabase
 * stack over HTTP and to Postgres directly, so a plain Node environment is
 * both enough and faster.
 *
 * `$lib` still has to resolve — `format.test.ts` imports from it.
 */
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /**
     * Every database test runs against the one local Postgres. Two files
     * mutating periods at the same time would fail each other intermittently,
     * which is worse than a slow suite: a flaky guard test teaches people to
     * re-run until green.
     */
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    /**
     * `.env` holds the local keys. Vite only exposes `PUBLIC_`-prefixed
     * variables to client code; here the whole file is read (empty prefix)
     * and handed to the test process, service role key included. Nothing in
     * `.env` is a credential for a deployed environment.
     */
    env: loadEnv(mode, process.cwd(), '')
  }
}));
