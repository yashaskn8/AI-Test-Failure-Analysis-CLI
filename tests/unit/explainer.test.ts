/**
 * Unit tests for the Explainer module.
 *
 * Tests mock explanations, LLM response parsing, and configuration.
 */

import { describe, it, expect } from 'vitest';
import {
  explain,
  getMockExplanation,
  parseLLMResponse,
  MOCK_EXPLANATIONS,
} from '../../src/explainer/index.js';
import type { LLMPrompt, FailureCategory } from '../../src/types.js';

/**
 * Helper to create a minimal LLM prompt for testing.
 */
function createPrompt(): LLMPrompt {
  return {
    systemPrompt: 'You are an expert.',
    userPrompt: 'Analyze this test failure: expected 4 to equal 5',
    estimatedTokens: 50,
  };
}

// ─── getMockExplanation ────────────────────────────────────────────

describe('getMockExplanation', () => {
  const categories: FailureCategory[] = [
    'timeout',
    'syntax_error',
    'type_error',
    'runtime_error',
    'assertion_failure',
    'dependency_error',
    'mock_error',
    'unhandled_rejection',
    'unknown',
  ];

  for (const category of categories) {
    it(`should return a mock explanation for "${category}"`, () => {
      const explanation = getMockExplanation(category);

      expect(explanation.rootCause).toBeTruthy();
      expect(explanation.suggestedFixes).toBeInstanceOf(Array);
      expect(explanation.suggestedFixes.length).toBeGreaterThan(0);
      expect(explanation.isMock).toBe(true);
    });
  }

  it('should have unique explanations per category', () => {
    const timeout = getMockExplanation('timeout');
    const assertion = getMockExplanation('assertion_failure');

    expect(timeout.rootCause).not.toBe(assertion.rootCause);
  });
});

// ─── parseLLMResponse ──────────────────────────────────────────────

describe('parseLLMResponse', () => {
  it('should parse a well-formatted JSON LLM response', () => {
    const content = JSON.stringify({
      rootCause: 'The function returns 4 instead of 5.',
      suggestedFixes: [
        'Update the calculation to add correctly.',
        'Check for off-by-one errors.',
      ],
      additionalContext: 'This is a common arithmetic mistake.',
    });

    const result = parseLLMResponse(content);

    expect(result.rootCause).toContain('returns 4 instead of 5');
    expect(result.suggestedFixes).toHaveLength(2);
    expect(result.suggestedFixes[0]).toContain('Update the calculation');
    expect(result.additionalContext).toContain('common arithmetic');
    expect(result.isMock).toBe(false);
  });

  it('should handle responses without additionalContext', () => {
    const content = JSON.stringify({
      rootCause: 'Missing null check.',
      suggestedFixes: ['Add optional chaining.'],
    });

    const result = parseLLMResponse(content);

    expect(result.rootCause).toContain('Missing null check');
    expect(result.suggestedFixes).toHaveLength(1);
    expect(result.additionalContext).toBeUndefined();
  });

  it('should handle unstructured/invalid JSON responses gracefully', () => {
    const content = 'The test fails because of a type mismatch. Not JSON.';
    const result = parseLLMResponse(content);

    // Should use the fallback parsing strategy for invalid JSON
    expect(result.rootCause).toContain('Failed to parse AI response');
    expect(result.additionalContext).toContain('type mismatch. Not JSON.');
    expect(result.isMock).toBe(false);
  });
});

// ─── explain ───────────────────────────────────────────────────────

describe('explain', () => {
  it('should return a mock explanation by default (LLM_ENABLE not set)', async () => {
    // Ensure LLM_ENABLE is not set
    delete process.env.LLM_ENABLE;

    const prompt = createPrompt();
    const result = await explain(prompt, 'assertion_failure');

    expect(result.isMock).toBe(true);
    expect(result.rootCause).toBeTruthy();
    expect(result.suggestedFixes.length).toBeGreaterThan(0);
  });
});

// ─── MOCK_EXPLANATIONS coverage ────────────────────────────────────

describe('MOCK_EXPLANATIONS', () => {
  it('should have entries for all known categories', () => {
    const expectedCategories: FailureCategory[] = [
      'timeout',
      'syntax_error',
      'type_error',
      'runtime_error',
      'assertion_failure',
      'dependency_error',
      'mock_error',
      'unhandled_rejection',
      'unknown',
    ];

    for (const cat of expectedCategories) {
      expect(MOCK_EXPLANATIONS[cat]).toBeDefined();
      expect(MOCK_EXPLANATIONS[cat]!.suggestedFixes.length).toBeGreaterThan(0);
    }
  });
});
