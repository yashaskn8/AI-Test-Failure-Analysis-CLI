#!/usr/bin/env node

/**
 * test-intel CLI binary entry point.
 *
 * This file bootstraps the CLI by importing the compiled TypeScript.
 * For development, use: npx tsx src/cli.ts <file>
 * For production, build first: npm run build
 */

import('../dist/cli.js').catch((err) => {
  // If the built output doesn't exist, try running from source via tsx
  import('tsx')
    .then(() => import('../src/cli.ts'))
    .catch(() => {
      console.error(
        'Error: Could not load test-intel.\n' +
        'Run "npm run build" first, or use "npx tsx src/cli.ts" for development.\n',
        err.message || err
      );
      process.exit(2);
    });
});
