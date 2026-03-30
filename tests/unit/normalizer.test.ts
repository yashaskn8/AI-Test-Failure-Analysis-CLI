/**
 * Unit tests for the Normalizer module.
 *
 * Tests stack trace parsing, ANSI stripping, error message cleaning,
 * and the full normalization pipeline.
 */

import { describe, it, expect } from 'vitest';
import {
  stripAnsi,
  parseStackFrame,
  parseStackTrace,
  cleanErrorMessage,
  normalizeFailure,
} from '../../src/normalizer/index.js';
import type { RawTestResult } from '../../src/types.js';

// ─── stripAnsi ─────────────────────────────────────────────────────

describe('stripAnsi', () => {
  it('should remove ANSI color codes', () => {
    const input = '\x1b[31mError\x1b[0m: something failed';
    expect(stripAnsi(input)).toBe('Error: something failed');
  });

  it('should handle strings without ANSI codes', () => {
    const input = 'plain text';
    expect(stripAnsi(input)).toBe('plain text');
  });

  it('should handle empty strings', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('should remove complex ANSI sequences', () => {
    const input = '\x1b[1m\x1b[38;5;196mBold Red\x1b[0m';
    expect(stripAnsi(input)).toBe('Bold Red');
  });
});

// ─── parseStackFrame ───────────────────────────────────────────────

describe('parseStackFrame', () => {
  it('should parse standard V8 stack frames', () => {
    const line = '    at myFunction (/path/to/file.ts:42:10)';
    const frame = parseStackFrame(line);

    expect(frame).not.toBeNull();
    expect(frame!.functionName).toBe('myFunction');
    expect(frame!.filePath).toBe('/path/to/file.ts');
    expect(frame!.line).toBe(42);
    expect(frame!.column).toBe(10);
    expect(frame!.isExternal).toBe(false);
  });

  it('should parse anonymous V8 stack frames', () => {
    const line = '    at /path/to/file.ts:10:5';
    const frame = parseStackFrame(line);

    expect(frame).not.toBeNull();
    expect(frame!.functionName).toBe('<anonymous>');
    expect(frame!.filePath).toBe('/path/to/file.ts');
    expect(frame!.line).toBe(10);
    expect(frame!.column).toBe(5);
  });

  it('should parse async stack frames', () => {
    const line = '    at async runTest (/src/runner.ts:100:3)';
    const frame = parseStackFrame(line);

    expect(frame).not.toBeNull();
    expect(frame!.functionName).toBe('runTest');
    expect(frame!.filePath).toBe('/src/runner.ts');
  });

  it('should mark node_modules frames as external', () => {
    const line =
      '    at Object.test (node_modules/vitest/dist/index.js:5:1)';
    const frame = parseStackFrame(line);

    expect(frame).not.toBeNull();
    expect(frame!.isExternal).toBe(true);
  });

  it('should mark node:internal frames as external', () => {
    const line =
      '    at Module._compile (node:internal/modules/cjs/loader:1234:14)';
    const frame = parseStackFrame(line);

    expect(frame).not.toBeNull();
    expect(frame!.isExternal).toBe(true);
  });

  it('should return null for non-stack-trace lines', () => {
    expect(parseStackFrame('Error: something went wrong')).toBeNull();
    expect(parseStackFrame('  expected: true')).toBeNull();
    expect(parseStackFrame('')).toBeNull();
  });
});

// ─── parseStackTrace ───────────────────────────────────────────────

describe('parseStackTrace', () => {
  it('should parse a multi-line stack trace', () => {
    const stack = [
      '    at userCode (/src/utils.ts:10:5)',
      '    at runTest (node_modules/vitest/dist/runner.js:100:3)',
      '    at processTicksAndRejections (node:internal/process:85:5)',
    ].join('\n');

    const frames = parseStackTrace(stack);

    expect(frames.length).toBeGreaterThanOrEqual(1);
    // User code should come first (sorted by isExternal)
    expect(frames[0]!.isExternal).toBe(false);
    expect(frames[0]!.functionName).toBe('userCode');
  });

  it('should handle empty stack traces', () => {
    expect(parseStackTrace('')).toEqual([]);
  });

  it('should filter noise lines', () => {
    const stack = [
      '    at userCode (/src/utils.ts:10:5)',
      '',
      '---',
      '    at processTicksAndRejections (node:internal/process:85:5)',
    ].join('\n');

    const frames = parseStackTrace(stack);
    // Should only have parseable frames
    expect(frames.every((f) => f.filePath)).toBe(true);
  });
});

// ─── cleanErrorMessage ─────────────────────────────────────────────

describe('cleanErrorMessage', () => {
  it('should clean AssertionError prefixes', () => {
    const msg = 'AssertionError: expected 4 to equal 5';
    const cleaned = cleanErrorMessage(msg);
    expect(cleaned).not.toContain('AssertionError:');
    expect(cleaned).toContain('4');
    expect(cleaned).toContain('5');
  });

  it('should strip ANSI codes from error messages', () => {
    const msg = '\x1b[31mTypeError\x1b[0m: x is not a function';
    const cleaned = cleanErrorMessage(msg);
    expect(cleaned).not.toContain('\x1b');
  });

  it('should handle empty/null input', () => {
    expect(cleanErrorMessage('')).toBe('Unknown error');
  });

  it('should collapse excessive whitespace', () => {
    const msg = 'Line one\n\n\n\n\nLine two';
    const cleaned = cleanErrorMessage(msg);
    expect(cleaned).not.toContain('\n\n\n');
  });
});

// ─── normalizeFailure ──────────────────────────────────────────────

describe('normalizeFailure', () => {
  it('should normalize a raw test result', () => {
    const raw: RawTestResult = {
      name: 'should work',
      suiteName: '/src/math.test.ts',
      status: 'fail',
      duration: 42,
      errorMessage: 'AssertionError: expected 4 to equal 5',
      stackTrace:
        '    at Object.test (/src/math.test.ts:10:5)\n' +
        '    at runTest (node_modules/vitest/dist/runner.js:100:3)',
    };

    const normalized = normalizeFailure(raw);

    expect(normalized.testName).toBe('should work');
    expect(normalized.suiteName).toBe('/src/math.test.ts');
    expect(normalized.duration).toBe(42);
    expect(normalized.errorMessage).not.toContain('AssertionError:');
    expect(normalized.stackFrames.length).toBeGreaterThan(0);
    // First frame should be user code
    expect(normalized.stackFrames[0]!.isExternal).toBe(false);
  });

  it('should handle missing stack trace', () => {
    const raw: RawTestResult = {
      name: 'no stack',
      suiteName: '/test.ts',
      status: 'fail',
      duration: 10,
      errorMessage: 'Something broke',
    };

    const normalized = normalizeFailure(raw);
    expect(normalized.stackFrames).toEqual([]);
    expect(normalized.errorMessage).toBe('Something broke');
  });
});
