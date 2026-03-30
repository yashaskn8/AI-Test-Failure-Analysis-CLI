/**
 * Prompt Builder Module
 *
 * Constructs optimized LLM prompts for test failure analysis.
 *
 * Design principles:
 * - Minimize token usage by excluding irrelevant data
 * - Include only the most relevant stack frames (user code)
 * - Provide structured context for consistent LLM responses
 * - Use a system prompt that guides the LLM's response format
 */

import type { ClassifiedFailure, LLMPrompt } from '../types.js';

/** Maximum number of stack frames to include in the prompt */
const MAX_STACK_FRAMES = 5;

/** Maximum error message length before truncation */
const MAX_ERROR_LENGTH = 1500;

/** Rough chars-per-token estimate for token counting */
const CHARS_PER_TOKEN = 4;

/**
 * System prompt instructs the LLM on how to analyze test failures.
 * Designed to produce consistent, actionable output.
 */
const SYSTEM_PROMPT = `You are an expert software engineer specializing in debugging test failures.
Your task is to analyze a failing test and provide:

1. **Root Cause**: A clear, concise explanation of why the test is failing.
2. **Suggested Fixes**: One or more actionable fixes, ordered by likelihood.
3. **Additional Context**: Any relevant background knowledge that helps understand the issue.

Guidelines:
- Be specific and actionable — avoid generic advice.
- Reference exact line numbers and function names when available.
- Consider the failure category to focus your analysis.
- If the fix involves code changes, show the corrected code.
- Keep your response concise but thorough.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "rootCause": "<one paragraph explanation>",
  "suggestedFixes": ["<specific actionable fix 1>", "<alternative fix 2>"],
  "additionalContext": "<optional additional context>"
}`;

/**
 * Build an optimized LLM prompt for a classified test failure.
 *
 * The prompt is structured to minimize token usage while providing
 * all the context an LLM needs to diagnose the failure and suggest fixes.
 *
 * @param failure - Classified failure with all analysis metadata
 * @returns Structured prompt ready for LLM consumption
 */
export function buildPrompt(failure: ClassifiedFailure): LLMPrompt {
  const userPrompt = constructUserPrompt(failure);
  const estimatedTokens = estimateTokenCount(SYSTEM_PROMPT + userPrompt);

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    estimatedTokens,
  };
}

/**
 * Construct the user message portion of the prompt.
 * Includes structured failure context in a token-efficient format.
 */
function constructUserPrompt(failure: ClassifiedFailure): string {
  const sections: string[] = [];

  // ── Header ──
  sections.push(`## Test Failure Analysis Request`);
  sections.push('');

  // ── Test Identity ──
  sections.push(`**Test Name:** ${failure.testName}`);
  sections.push(`**Suite:** ${formatSuiteName(failure.suiteName)}`);
  sections.push(`**Duration:** ${failure.duration}ms`);
  sections.push('');

  // ── Classification ──
  sections.push(`**Failure Category:** ${formatCategory(failure.classification.category)}`);
  sections.push(`**Confidence:** ${failure.classification.confidence}`);
  sections.push(`**Detection Reason:** ${failure.classification.reason}`);
  sections.push('');

  // ── Error Message ──
  sections.push('### Error Message');
  sections.push('```');
  sections.push(truncate(failure.errorMessage, MAX_ERROR_LENGTH));
  sections.push('```');
  sections.push('');

  // ── Relevant Stack Frames & Context ──
  const relevantFrames = failure.stackFrames
    .filter((f) => !f.isExternal)
    .slice(0, MAX_STACK_FRAMES);

  if (relevantFrames.length > 0) {
    sections.push('### Relevant Stack Trace & Code Context');
    for (const frame of relevantFrames) {
      sections.push(`**File:** \`${frame.filePath}:${frame.line}:${frame.column}\``);
      sections.push(`**Function:** \`${frame.functionName}\``);
      if (frame.codeContext) {
        sections.push('```typescript');
        sections.push(frame.codeContext);
        sections.push('```');
      }
      sections.push('');
    }
  }

  // ── External Frames Summary (compressed) ──
  const externalFrames = failure.stackFrames.filter((f) => f.isExternal);
  if (externalFrames.length > 0) {
    sections.push(
      `*${externalFrames.length} external frame(s) omitted (framework/library code)*`
    );
    sections.push('');
  }

  // ── Analysis Request ──
  sections.push('### Instructions');
  sections.push(
    'Analyze this test failure and provide the root cause, suggested fix(es), ' +
    'and any additional context. Focus on actionable debugging steps.'
  );

  return sections.join('\n');
}

/**
 * Format a failure category for human-readable display.
 */
function formatCategory(category: string): string {
  return category
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format a suite name by extracting the most relevant path portion.
 */
function formatSuiteName(suiteName: string): string {
  // Show only the last 3 path segments for readability
  const parts = suiteName.replace(/\\/g, '/').split('/');
  if (parts.length > 3) {
    return '.../' + parts.slice(-3).join('/');
  }
  return suiteName;
}

/**
 * Truncate a string to a maximum length, appending an indicator if truncated.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '\n... [truncated for token efficiency]';
}

/**
 * Rough token count estimation (for informational purposes).
 * Uses a simple chars/token heuristic — not meant for billing accuracy.
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export { constructUserPrompt, SYSTEM_PROMPT, estimateTokenCount };
