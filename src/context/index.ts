/**
 * Context Hydration Module
 *
 * Reads source code from disk to attach snippet context
 * to stack frames identified in test failures.
 * This gives the LLM precise visibility into exactly
 * what code triggered the failure.
 */

import { promises as fs } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import type { NormalizedFailure } from '../types.js';

/** Number of lines above and below the target line to extract */
const CONTEXT_RADIUS = 5;

/**
 * Hydrate stack frames with their actual source code snippets.
 * This happens asynchronously as it involves reading files from disk.
 *
 * @param failure - The normalized failure to hydrate
 * @param cwd - The root directory to resolve relative paths against
 */
export async function hydrateContext(
  failure: NormalizedFailure,
  cwd: string = process.cwd()
): Promise<void> {
  const fileCache = new Map<string, string[]>();

  for (const frame of failure.stackFrames) {
    if (frame.isExternal || !frame.filePath) continue;

    try {
      const absolutePath = isAbsolute(frame.filePath)
        ? frame.filePath
        : resolve(cwd, frame.filePath);

      let lines = fileCache.get(absolutePath);

      if (!lines) {
        const content = await fs.readFile(absolutePath, 'utf8');
        lines = content.split('\n');
        fileCache.set(absolutePath, lines);
      }

      // 1-based index mapping to array index
      const targetIndex = frame.line - 1;
      const startIndex = Math.max(0, targetIndex - CONTEXT_RADIUS);
      const endIndex = Math.min(lines.length, targetIndex + CONTEXT_RADIUS + 1);

      const snippetLines = [];
      for (let i = startIndex; i < endIndex; i++) {
        const lineNum = i + 1;
        const isTarget = lineNum === frame.line;
        const marker = isTarget ? ' >> ' : '    ';
        // Prefix with formatted line number to help the LLM anchor itself
        const prefix = lineNum.toString().padStart(4, ' ');
        snippetLines.push(`${prefix}${marker}${lines[i]}`);
      }

      frame.codeContext = snippetLines.join('\n');
    } catch {
      // Missing file / read error (could be source-mapped to non-existent file)
      // We gracefully fall back to not having context for this frame.
      frame.codeContext = `// Unable to extract source code from: ${frame.filePath}`;
    }
  }
}

/**
 * Hydrate multiple failures in parallel.
 */
export async function hydrateFailures(
  failures: NormalizedFailure[],
  cwd: string = process.cwd()
): Promise<void> {
  await Promise.all(failures.map((f) => hydrateContext(f, cwd)));
}
