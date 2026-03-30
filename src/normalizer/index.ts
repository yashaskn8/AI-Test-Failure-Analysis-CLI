/**
 * Normalizer Module
 *
 * Cleans raw error messages and stack traces from test failures.
 * Handles V8 stack traces and various non-standard formats.
 *
 * Key responsibilities:
 * - Parse V8-style stack traces into structured StackFrame objects
 * - Filter out noise (node_modules, internal V8 frames)
 * - Clean ANSI codes and irrelevant formatting
 * - Prioritize user-authored code frames over framework internals
 */

import type {
  RawTestResult,
  NormalizedFailure,
  StackFrame,
} from '../types.js';

// ─── ANSI / Noise Cleanup ──────────────────────────────────────────

/** Regex to strip ANSI escape codes from strings */
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/** Lines that are considered noise and should be removed */
const NOISE_PATTERNS = [
  /^\s*$/,                          // Empty lines
  /^-{3,}$/,                        // Separator lines
  /^={3,}$/,
  /^\s*\^+\s*$/,                    // Caret indicators
  /Vitest\s+v[\d.]+/i,             // Version banners
  /^\s*at\s+processTicksAndRejections/,  // Internal Node.js frames
  /^\s*at\s+async\s+Promise\.all/,       // Promise machinery
];

/**
 * Remove ANSI escape codes from a string.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

/**
 * Check if a line is noise (irrelevant to debugging).
 */
function isNoiseLine(line: string): boolean {
  const cleaned = line.trim();
  if (!cleaned) return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(cleaned));
}

// ─── Stack Trace Parsing ───────────────────────────────────────────

/**
 * V8 stack frame patterns:
 *
 * Standard:    "    at functionName (filePath:line:column)"
 * Anonymous:   "    at filePath:line:column"
 * Eval:        "    at eval (eval at <anonymous> (...), ...)"
 * Async:       "    at async functionName (filePath:line:column)"
 */
const V8_FRAME_REGEX =
  /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

/**
 * Alternative format sometimes seen in bundled/transpiled output:
 * "filePath:line:column"
 */
const SIMPLE_FRAME_REGEX = /^(.+?):(\d+):(\d+)$/;

/**
 * Parse a single stack trace line into a StackFrame.
 * Returns null if the line doesn't match any known format.
 */
export function parseStackFrame(line: string): StackFrame | null {
  const cleaned = stripAnsi(line).trim();

  // Try V8 format first
  const v8Match = cleaned.match(V8_FRAME_REGEX);
  if (v8Match) {
    const [, funcName, filePath, lineStr, colStr] = v8Match;
    const parsedPath = filePath || '';
    return {
      functionName: funcName || '<anonymous>',
      filePath: parsedPath,
      line: parseInt(lineStr || '0', 10),
      column: parseInt(colStr || '0', 10),
      isExternal: isExternalFrame(parsedPath),
    };
  }

  // Try simple format
  const simpleMatch = cleaned.match(SIMPLE_FRAME_REGEX);
  if (simpleMatch) {
    const [, filePath, lineStr, colStr] = simpleMatch;
    return {
      functionName: '<anonymous>',
      filePath: filePath || '',
      line: parseInt(lineStr || '0', 10),
      column: parseInt(colStr || '0', 10),
      isExternal: isExternalFrame(filePath || ''),
    };
  }

  return null;
}

/**
 * Determine if a file path represents external/framework code.
 * External frames are deprioritized in analysis.
 */
function isExternalFrame(filePath: string): boolean {
  const externalIndicators = [
    'node_modules',
    'node:internal',
    'node:',
    '__vitest__',
    'vitest/dist',
    'vitest/src',
    'chai/lib',
    '<anonymous>',
  ];
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return externalIndicators.some((indicator) =>
    normalized.includes(indicator.toLowerCase())
  );
}

/**
 * Parse a full stack trace string into an array of StackFrame objects.
 * Filters out noise frames and sorts by relevance (user code first).
 */
export function parseStackTrace(stackTrace: string): StackFrame[] {
  if (!stackTrace) return [];

  const lines = stripAnsi(stackTrace).split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    if (isNoiseLine(line)) continue;
    const frame = parseStackFrame(line);
    if (frame) {
      frames.push(frame);
    }
  }

  // Sort: user code first, then external
  return frames.sort((a, b) => {
    if (a.isExternal === b.isExternal) return 0;
    return a.isExternal ? 1 : -1;
  });
}

// ─── Error Message Cleaning ────────────────────────────────────────

/**
 * Clean an error message by removing noise, ANSI codes, and
 * redundant formatting. Preserves the meaningful content.
 */
export function cleanErrorMessage(raw: string): string {
  if (!raw) return 'Unknown error';

  let cleaned = stripAnsi(raw);

  // Remove common prefixes added by test frameworks
  cleaned = cleaned
    .replace(/^(AssertionError|Error|TypeError|ReferenceError|SyntaxError):\s*/i, '')
    .replace(/^expected\s+/i, 'Expected ')
    .trim();

  // Remove redundant line breaks
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Collapse excessive whitespace within lines
  cleaned = cleaned
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !isNoiseLine(line))
    .join('\n')
    .trim();

  return cleaned || 'Unknown error';
}

// ─── Main Normalizer ───────────────────────────────────────────────

/**
 * Normalize a raw test failure into a clean, structured format.
 *
 * @param raw - Raw test result from the collector
 * @returns Normalized failure with parsed stack frames and clean messages
 */
export function normalizeFailure(raw: RawTestResult): NormalizedFailure {
  const errorMessage = cleanErrorMessage(raw.errorMessage || '');
  const stackFrames = parseStackTrace(raw.stackTrace || '');

  return {
    testName: raw.name,
    suiteName: raw.suiteName,
    duration: raw.duration,
    errorMessage,
    stackFrames,
    rawError: raw.errorMessage || '',
  };
}

/**
 * Normalize an array of raw test results.
 */
export function normalizeFailures(
  rawResults: RawTestResult[]
): NormalizedFailure[] {
  return rawResults.map(normalizeFailure);
}
