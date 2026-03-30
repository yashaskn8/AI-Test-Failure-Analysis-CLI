/**
 * Unit tests for the Detector module.
 *
 * Tests heuristic classification of all failure categories
 * with various error message patterns.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyFailure,
  detectFailure,
  detectFailures,
} from '../../src/detector/index.js';
import type { NormalizedFailure } from '../../src/types.js';

/**
 * Helper to create a minimal NormalizedFailure for testing.
 */
function createFailure(
  errorMessage: string,
  rawError?: string
): NormalizedFailure {
  return {
    testName: 'test case',
    suiteName: '/test.ts',
    duration: 10,
    errorMessage,
    stackFrames: [],
    rawError: rawError || errorMessage,
  };
}

// ─── Timeout Detection ─────────────────────────────────────────────

describe('Timeout detection', () => {
  it('should detect "timed out" messages', () => {
    const result = classifyFailure(
      createFailure('Test timed out in 5000ms')
    );
    expect(result.category).toBe('timeout');
    expect(result.confidence).not.toBe('low');
  });

  it('should detect "timeout exceeded" messages', () => {
    const result = classifyFailure(
      createFailure('Timeout of 10000ms exceeded')
    );
    expect(result.category).toBe('timeout');
  });

  it('should detect hook timeout', () => {
    const result = classifyFailure(
      createFailure('hook timed out after 5000ms')
    );
    expect(result.category).toBe('timeout');
  });
});

// ─── Syntax Error Detection ────────────────────────────────────────

describe('Syntax Error detection', () => {
  it('should detect SyntaxError', () => {
    const result = classifyFailure(
      createFailure('SyntaxError: Unexpected token }')
    );
    expect(result.category).toBe('syntax_error');
  });

  it('should detect unexpected token errors', () => {
    const result = classifyFailure(
      createFailure('Unexpected token < in JSON at position 0')
    );
    expect(result.category).toBe('syntax_error');
  });

  it('should detect import statement errors', () => {
    const result = classifyFailure(
      createFailure(
        'Cannot use import statement outside a module'
      )
    );
    expect(result.category).toBe('syntax_error');
  });
});

// ─── Dependency Error Detection ────────────────────────────────────

describe('Dependency Error detection', () => {
  it('should detect "Cannot find module"', () => {
    const result = classifyFailure(
      createFailure("Cannot find module './missing-module'")
    );
    expect(result.category).toBe('dependency_error');
  });

  it('should detect ERR_MODULE_NOT_FOUND', () => {
    const result = classifyFailure(
      createFailure('ERR_MODULE_NOT_FOUND: Cannot find package')
    );
    expect(result.category).toBe('dependency_error');
  });

  it('should detect package subpath errors', () => {
    const result = classifyFailure(
      createFailure(
        "Package subpath './dist/utils' is not defined by exports"
      )
    );
    expect(result.category).toBe('dependency_error');
  });
});

// ─── Assertion Failure Detection ───────────────────────────────────

describe('Assertion Failure detection', () => {
  it('should detect AssertionError', () => {
    const result = classifyFailure(
      createFailure('AssertionError: expected 4 to equal 5')
    );
    expect(result.category).toBe('assertion_failure');
  });

  it('should detect toBe assertions', () => {
    const result = classifyFailure(
      createFailure('expected 4 to be 5 // toBe(5)')
    );
    expect(result.category).toBe('assertion_failure');
  });

  it('should detect toEqual assertions', () => {
    const result = classifyFailure(
      createFailure(
        'expected { a: 1 } to deeply equal { a: 2 } // toEqual({ a: 2 })'
      )
    );
    expect(result.category).toBe('assertion_failure');
  });

  it('should detect snapshot mismatches', () => {
    const result = classifyFailure(
      createFailure('Snapshot mismatch: received value does not match')
    );
    expect(result.category).toBe('assertion_failure');
  });

  it('should detect expected/received patterns', () => {
    const result = classifyFailure(
      createFailure('expected: "hello" received: "world"')
    );
    expect(result.category).toBe('assertion_failure');
  });
});

// ─── Type Error Detection ───────────────────────────────────────

describe('Type Error detection', () => {
  it('should detect TypeError', () => {
    const result = classifyFailure(
      createFailure('TypeError: x is not a function')
    );
    expect(result.category).toBe('type_error');
  });

  it('should detect null property access', () => {
    const result = classifyFailure(
      createFailure(
        "Cannot read properties of null (reading 'name')"
      )
    );
    expect(result.category).toBe('type_error');
  });
});

// ─── Runtime Error Detection ───────────────────────────────────────

describe('Runtime Error detection', () => {
  it('should detect ReferenceError', () => {
    const result = classifyFailure(
      createFailure('ReferenceError: foo is not defined')
    );
    expect(result.category).toBe('runtime_error');
  });

  it('should detect stack overflow', () => {
    const result = classifyFailure(
      createFailure('Maximum call stack size exceeded')
    );
    expect(result.category).toBe('runtime_error');
  });
});

// ─── Unknown Detection ─────────────────────────────────────────────

describe('Unknown failure detection', () => {
  it('should return unknown for unrecognized errors', () => {
    const result = classifyFailure(
      createFailure('Some completely random error message XYZ123')
    );
    expect(result.category).toBe('unknown');
    expect(result.confidence).toBe('low');
  });
});

// ─── detectFailure / detectFailures ────────────────────────────────

describe('detectFailure', () => {
  it('should enrich a normalized failure with classification', () => {
    const failure = createFailure('TypeError: x is not a function');
    const classified = detectFailure(failure);

    expect(classified.classification).toBeDefined();
    expect(classified.classification.category).toBe('type_error');
    expect(classified.testName).toBe('test case');
  });
});

describe('detectFailures', () => {
  it('should classify multiple failures', () => {
    const failures = [
      createFailure('Test timed out'),
      createFailure('AssertionError: expected true to be false'),
      createFailure('TypeError: undefined is not a function'),
    ];

    const classified = detectFailures(failures);

    expect(classified).toHaveLength(3);
    expect(classified[0]!.classification.category).toBe('timeout');
    expect(classified[1]!.classification.category).toBe('assertion_failure');
    expect(classified[2]!.classification.category).toBe('type_error');
  });
});
