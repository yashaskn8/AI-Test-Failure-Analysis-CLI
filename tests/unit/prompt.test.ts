/**
 * Unit tests for the Prompt Builder module.
 *
 * Tests prompt construction, token estimation, and content formatting.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPrompt,
  SYSTEM_PROMPT,
  estimateTokenCount,
} from '../../src/prompt/index.js';
import type { ClassifiedFailure } from '../../src/types.js';

/**
 * Helper to create a minimal ClassifiedFailure for testing.
 */
function createClassifiedFailure(
  overrides: Partial<ClassifiedFailure> = {}
): ClassifiedFailure {
  return {
    testName: 'should add numbers',
    suiteName: '/src/math.test.ts',
    duration: 42,
    errorMessage: 'expected 4 to equal 5',
    stackFrames: [
      {
        functionName: 'testAdd',
        filePath: '/src/math.test.ts',
        line: 10,
        column: 5,
        isExternal: false,
      },
      {
        functionName: 'runSuite',
        filePath: 'node_modules/vitest/dist/runner.js',
        line: 200,
        column: 10,
        isExternal: true,
      },
    ],
    rawError: 'AssertionError: expected 4 to equal 5',
    classification: {
      category: 'assertion_failure',
      confidence: 'high',
      reason: 'Test assertion mismatch',
      matchedPatterns: ['AssertionError'],
    },
    ...overrides,
  };
}

// ─── buildPrompt ───────────────────────────────────────────────────

describe('buildPrompt', () => {
  it('should generate a valid LLM prompt', () => {
    const failure = createClassifiedFailure();
    const prompt = buildPrompt(failure);

    expect(prompt.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(prompt.userPrompt).toBeTruthy();
    expect(prompt.estimatedTokens).toBeGreaterThan(0);
  });

  it('should include the test name in the prompt', () => {
    const failure = createClassifiedFailure({
      testName: 'unique-test-name-xyz',
    });
    const prompt = buildPrompt(failure);
    expect(prompt.userPrompt).toContain('unique-test-name-xyz');
  });

  it('should include the error message in the prompt', () => {
    const failure = createClassifiedFailure({
      errorMessage: 'specific error message 12345',
    });
    const prompt = buildPrompt(failure);
    expect(prompt.userPrompt).toContain('specific error message 12345');
  });

  it('should include the failure category', () => {
    const failure = createClassifiedFailure();
    const prompt = buildPrompt(failure);
    expect(prompt.userPrompt).toContain('Assertion Failure');
  });

  it('should include user code stack frames but not external ones', () => {
    const failure = createClassifiedFailure();
    const prompt = buildPrompt(failure);

    // Should include user code frame
    expect(prompt.userPrompt).toContain('testAdd');
    expect(prompt.userPrompt).toContain('/src/math.test.ts');

    // Should mention that external frames were omitted
    expect(prompt.userPrompt).toContain('external frame');
  });

  it('should handle failures with no stack frames', () => {
    const failure = createClassifiedFailure({ stackFrames: [] });
    const prompt = buildPrompt(failure);
    expect(prompt.userPrompt).toBeTruthy();
    expect(prompt.userPrompt).not.toContain('Stack Trace');
  });
});

// ─── estimateTokenCount ────────────────────────────────────────────

describe('estimateTokenCount', () => {
  it('should estimate tokens based on character count', () => {
    // ~4 chars per token
    const tokens = estimateTokenCount('a'.repeat(400));
    expect(tokens).toBe(100);
  });

  it('should return 0 for empty strings', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('should round up', () => {
    const tokens = estimateTokenCount('abc'); // 3 chars / 4 = 0.75 → 1
    expect(tokens).toBe(1);
  });
});

// ─── SYSTEM_PROMPT ─────────────────────────────────────────────────

describe('SYSTEM_PROMPT', () => {
  it('should instruct the LLM to analyze test failures', () => {
    expect(SYSTEM_PROMPT).toContain('Root Cause');
    expect(SYSTEM_PROMPT).toContain('Suggested Fixes');
  });

  it('should define the expected response format', () => {
    expect(SYSTEM_PROMPT).toContain('"rootCause":');
    expect(SYSTEM_PROMPT).toContain('"suggestedFixes":');
  });
});
