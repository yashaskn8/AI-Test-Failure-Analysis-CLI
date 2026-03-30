/**
 * Explainer Module
 *
 * Abstracts LLM interaction for generating test failure explanations.
 * Supports two modes:
 *
 * 1. **Mock Mode** (default): Returns realistic, category-aware mock
 *    explanations for development and testing without API costs.
 *
 * 2. **Real API Mode**: Calls an OpenAI-compatible API when
 *    LLM_ENABLE=true and OPENAI_API_KEY is set.
 *
 * The module is designed to be extensible — additional LLM providers
 * can be added by implementing the ExplainerBackend interface pattern.
 */

import type { LLMPrompt, Explanation, FailureCategory } from '../types.js';

// ─── Configuration ─────────────────────────────────────────────────

interface ExplainerConfig {
  /** Whether to use real LLM API calls */
  enabled: boolean;
  /** API key for the LLM provider */
  apiKey?: string;
  /** API base URL (defaults to OpenAI) */
  apiBaseUrl?: string;
  /** Model to use */
  model?: string;
}

/**
 * Resolve explainer configuration from environment variables.
 */
function getConfig(): ExplainerConfig {
  return {
    enabled: process.env.LLM_ENABLE === 'true',
    apiKey: process.env.OPENAI_API_KEY,
    apiBaseUrl: process.env.LLM_API_BASE || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
  };
}

// ─── Mock Explanations ─────────────────────────────────────────────

/**
 * Category-specific mock explanations that provide realistic responses
 * for development and testing without API calls.
 */
const MOCK_EXPLANATIONS: Record<FailureCategory, Explanation> = {
  timeout: {
    rootCause:
      'The test exceeded its configured timeout limit. This typically occurs when ' +
      'an asynchronous operation (such as an API call, database query, or event listener) ' +
      'never resolves or takes longer than expected. Common causes include: missing ' +
      'callback invocations, unresolved promises, infinite loops, or slow external services.',
    suggestedFixes: [
      'Increase the test timeout using `{ timeout: 10000 }` in the test options if the operation genuinely needs more time.',
      'Ensure all async operations are properly awaited and all callbacks are invoked.',
      'Mock external dependencies (network calls, timers) to eliminate real wait times.',
      'Check for infinite loops or recursive calls that never terminate.',
      'Use `vi.useFakeTimers()` for timer-dependent code.',
    ],
    isMock: true,
  },
  syntax_error: {
    rootCause:
      'The code contains a syntax error that prevents the JavaScript engine from parsing it. ' +
      'This is typically caused by a typo, missing bracket/semicolon, incorrect import syntax, ' +
      'or using unsupported language features for the configured target environment.',
    suggestedFixes: [
      'Check the error message for the exact location of the syntax issue and fix the indicated token.',
      'Verify that the TypeScript/JavaScript target in your config supports the syntax being used.',
      'If using ESM imports in a CommonJS context, update the module system configuration.',
      'Run a linter (ESLint) to catch syntax issues before test execution.',
    ],
    isMock: true,
  },
  runtime_error: {
    rootCause:
      'A runtime exception occurred during test execution. The code parsed correctly but ' +
      'encountered an error when running — such as accessing a property on null/undefined, ' +
      'calling a non-function value, or exceeding the call stack size. This usually indicates ' +
      'a logic error or incorrect assumptions about data/state.',
    suggestedFixes: [
      'Check the stack trace to identify the exact line causing the error.',
      'Add null/undefined checks before accessing nested properties (optional chaining: `?.`).',
      'Verify that imported functions/modules export what you expect.',
      'Ensure mock objects have the correct shape and method signatures.',
      'Add defensive validation for function parameters.',
    ],
    isMock: true,
  },
  type_error: {
    rootCause:
      'A type error occurred, usually meaning a variable or argument was not of the expected type. ' +
      'In TypeScript contexts, this can be an incorrect assertion, or attempting to call a non-function, ' +
      'iterate a non-iterable, or access properties on null/undefined.',
    suggestedFixes: [
      'Verify the actual type of the variable at runtime (it may differ from the TypeScript type).',
      'Check the line of code identified in the stack trace for null/undefined assumptions.',
      'Ensure default values are provided if a variable can be undefined.',
    ],
    isMock: true,
  },
  mock_error: {
    rootCause:
      'A failure occurred interacting with mock functions or spies. This typically happens ' +
      'when spying on a non-existent method, calling mock methods on unmocked objects, or ' +
      'incorrectly stubbing module implementations.',
    suggestedFixes: [
      'Ensure the method exists on the object before calling `vi.spyOn(obj, "method")`.',
      'If mocking a module, verify the path matches exactly and `vi.mock()` is hoisted.',
      'Check if you accidentally reset the mock implementation before the assertion.',
    ],
    isMock: true,
  },
  unhandled_rejection: {
    rootCause:
      'A Promise was rejected but there was no `.catch()` block or `await/try-catch` to handle it. ' +
      'Test frameworks often surface these as unhandled exceptions that crash the test execution globally.',
    suggestedFixes: [
      'Ensure all asynchronous operations are properly `await`ed in the test and the code under test.',
      'Wrap suspected async calls in a `try-catch` block.',
      'Check if a mocked async function is returning a rejected promise unexpectedly.',
    ],
    isMock: true,
  },
  assertion_failure: {
    rootCause:
      'A test assertion did not match the expected value. The code ran successfully, but ' +
      'the output/behavior differed from what the test expected. This can indicate either ' +
      'a bug in the implementation or an out-of-date test expectation.',
    suggestedFixes: [
      'Compare the expected and actual values carefully — check for type mismatches (e.g., string vs number).',
      'If the implementation changed intentionally, update the test assertion to match the new behavior.',
      'Check for off-by-one errors, incorrect sort orders, or missing array/object properties.',
      'For snapshot failures, review the diff and run `vitest --update` if the change is intentional.',
      'Verify that test setup/fixtures provide the correct initial state.',
    ],
    isMock: true,
  },
  dependency_error: {
    rootCause:
      'A required module or package could not be found or resolved. This indicates either ' +
      'a missing installation, incorrect import path, or incompatible package configuration ' +
      '(e.g., ESM/CJS mismatch, missing export map entry).',
    suggestedFixes: [
      'Run `npm install` to ensure all dependencies are installed.',
      'Check the import path for typos and correct casing (file systems may be case-sensitive).',
      'Verify the package.json "exports" field if using subpath imports.',
      'For ESM/CJS issues, check that both your config and the dependency use compatible module systems.',
      'If using path aliases, ensure they are configured in both tsconfig.json and vitest.config.',
    ],
    isMock: true,
  },
  unknown: {
    rootCause:
      'The failure could not be automatically classified into a known category. The error ' +
      'pattern does not match common failure types. Manual inspection of the full error ' +
      'output and stack trace is recommended.',
    suggestedFixes: [
      'Review the full error message and stack trace for clues.',
      'Run the failing test in isolation with `vitest run <file> --reporter=verbose`.',
      'Check for environment-specific issues (OS, Node.js version, CI vs local).',
      'Search the error message online for known issues with your dependencies.',
    ],
    isMock: true,
  },
};

// ─── Real LLM Backend ──────────────────────────────────────────────

/**
 * Call an OpenAI-compatible API to generate a real explanation.
 *
 * @param prompt - Structured LLM prompt
 * @param config - Explainer configuration
 * @returns Parsed explanation from the LLM response
 */
async function callLLMApi(
  prompt: LLMPrompt,
  config: ExplainerConfig
): Promise<Explanation> {
  if (!config.apiKey) {
    throw new Error(
      'OPENAI_API_KEY environment variable is required when LLM_ENABLE=true.\n' +
      'Set it with: export OPENAI_API_KEY=your-key-here'
    );
  }

  const response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: prompt.systemPrompt },
        { role: 'user', content: prompt.userPrompt },
      ],
      temperature: 0.1, // Lower temperature for structured, deterministic analysis
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content || '';
  return parseLLMResponse(content);
}

/**
 * Parse the structured LLM response into an Explanation object.
 * Handles the JSON response format expected from the AI.
 */
function parseLLMResponse(content: string): Explanation {
  try {
    const parsed = JSON.parse(content);
    return {
      rootCause: parsed.rootCause || 'Root cause not provided.',
      suggestedFixes: Array.isArray(parsed.suggestedFixes) 
        ? parsed.suggestedFixes 
        : [parsed.suggestedFixes].filter(Boolean),
      additionalContext: parsed.additionalContext,
      isMock: false,
    };
  } catch (error) {
    // Fallback if LLM fails to return valid JSON
    return {
      rootCause: 'Failed to parse AI response.',
      suggestedFixes: ['Try running the analysis again with a different model or lower temperature.'],
      additionalContext: `Raw output:\n${content}`,
      isMock: false,
    };
  }
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Generate an explanation for a test failure.
 *
 * Automatically selects between mock and real LLM backends based on
 * environment configuration.
 *
 * @param prompt - Structured LLM prompt from the prompt builder
 * @param category - Failure category for mock response selection
 * @returns Explanation with root cause and fix suggestions
 */
export async function explain(
  prompt: LLMPrompt,
  category: FailureCategory
): Promise<Explanation> {
  const config = getConfig();

  if (config.enabled) {
    try {
      return await callLLMApi(prompt, config);
    } catch (error) {
      // Graceful fallback to mock if API fails
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      console.warn(`⚠ LLM API call failed, falling back to mock: ${message}`);
      return getMockExplanation(category);
    }
  }

  return getMockExplanation(category);
}

/**
 * Get a mock explanation for a given failure category.
 */
export function getMockExplanation(category: FailureCategory): Explanation {
  return MOCK_EXPLANATIONS[category] || MOCK_EXPLANATIONS.unknown;
}

export { parseLLMResponse, getConfig, MOCK_EXPLANATIONS };
