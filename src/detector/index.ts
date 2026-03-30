/**
 * Detector Module
 *
 * Implements heuristic-based classification of test failures.
 * Uses pattern matching on error messages, stack frames, and
 * contextual signals to categorize failures into known types.
 *
 * Categories:
 * - timeout:         Test exceeded time limit
 * - syntax_error:        Code parsing/syntax issues
 * - type_error:          Type mismatches, especially in TypeScript
 * - runtime_error:       Runtime exceptions (ReferenceError, undefined access, etc.)
 * - assertion_failure:   Test assertion mismatch (expected vs actual)
 * - dependency_error:    Missing modules or import failures
 * - mock_error:          Improper mock usage or spy errors
 * - unhandled_rejection: Uncaught Promise rejection
 * - unknown:             No pattern matched
 *
 * Each classifier returns a confidence score to handle ambiguous cases.
 */

import type {
  NormalizedFailure,
  ClassifiedFailure,
  Classification,
  FailureCategory,
  Confidence,
} from '../types.js';

// ─── Pattern Definitions ───────────────────────────────────────────

interface DetectionRule {
  category: FailureCategory;
  patterns: RegExp[];
  confidence: Confidence;
  reason: string;
}

/**
 * Ordered list of detection rules. Earlier rules take priority
 * when multiple patterns match (higher specificity first).
 */
const DETECTION_RULES: DetectionRule[] = [
  // ── Timeout ──
  {
    category: 'timeout',
    patterns: [
      /timed?\s*out/i,
      /timeout\s*(of\s+)?\d+\s*ms\s*(exceeded|reached)/i,
      /exceeded\s+timeout/i,
      /vitest.*timeout/i,
      /test\s+timed?\s*out\s+in/i,
      /hook\s+timed?\s*out/i,
      /async\s+callback.*not\s+invoked\s+within/i,
    ],
    confidence: 'high',
    reason: 'Error message indicates a timeout condition',
  },

  // ── Syntax Error ──
  {
    category: 'syntax_error',
    patterns: [
      /SyntaxError/i,
      /Unexpected\s+token/i,
      /Unexpected\s+end\s+of\s+(input|JSON)/i,
      /unterminated\s+string/i,
      /missing\s+[;:,)}\]]/i,
      /Invalid\s+or\s+unexpected\s+token/i,
      /Cannot\s+use\s+import\s+statement/i,
      /Unexpected\s+reserved\s+word/i,
      /Failed\s+to\s+parse\s+source/i,
    ],
    confidence: 'high',
    reason: 'Error indicates a code syntax or parsing issue',
  },

  // ── Dependency Error ──
  {
    category: 'dependency_error',
    patterns: [
      /Cannot\s+find\s+module/i,
      /Module\s+not\s+found/i,
      /ERR_MODULE_NOT_FOUND/i,
      /Cannot\s+resolve\s+(module|package|dependency)/i,
      /Failed\s+to\s+resolve\s+(import|module)/i,
      /ENOENT.*node_modules/i,
      /Could\s+not\s+locate\s+module/i,
      /No\s+matching\s+export/i,
      /Package\s+subpath.*not\s+defined/i,
      /ERR_PACKAGE_PATH_NOT_EXPORTED/i,
    ],
    confidence: 'high',
    reason: 'Error indicates a missing dependency or import resolution failure',
  },

  // ── Assertion Failure ──
  {
    category: 'assertion_failure',
    patterns: [
      /AssertionError/i,
      /expected\s+.*\s*(to\s+(be|equal|have|match|include|contain|throw|satisfy|deep))/i,
      /toBe\s*\(/i,
      /toEqual\s*\(/i,
      /toMatch\s*\(/i,
      /toContain\s*\(/i,
      /toThrow\s*\(/i,
      /toHaveBeenCalled/i,
      /toHaveLength\s*\(/i,
      /received.*expected/i,
      /expected.*received/i,
      /assert\.(strict)?(equal|deep|ok|fail|throws)/i,
      /Snapshot.*mismatch/i,
      /toMatchSnapshot/i,
      /toMatchInlineSnapshot/i,
    ],
    confidence: 'high',
    reason: 'Error indicates a test assertion mismatch',
  },

  // ── Unhandled Rejection ──
  {
    category: 'unhandled_rejection',
    patterns: [
      /UnhandledRejection/i,
      /unhandled\s+promise/i,
      /Uncaught\s+\(in\s+promise\)/i,
      /rejected\s+promise\s+not\s+handled/i,
    ],
    confidence: 'high',
    reason: 'An asynchronous promise was rejected but not caught/handled',
  },

  // ── Mock Error ──
  {
    category: 'mock_error',
    patterns: [
      /Cannot\s+spy\s+on/i,
      /mockConstructor/i,
      /is\s+not\s+a\s+spy/i,
      /mock\w+\s+is\s+not\s+a\s+function/i,
      /spyOn/i,
      /vitest\.mock/i,
      /vi\.mock/i,
    ],
    confidence: 'high',
    reason: 'Issue related to mocking dependencies or function spies',
  },

  // ── Type Error ──
  {
    category: 'type_error',
    patterns: [
      /TypeError/i,
      /is\s+not\s+a\s+function/i,
      /is\s+not\s+iterable/i,
      /is\s+not\s+constructable/i,
      /Cannot\s+read\s+propert(y|ies)\s+of\s+(null|undefined)/i,
      /Cannot\s+set\s+propert(y|ies)\s+of\s+(null|undefined)/i,
    ],
    confidence: 'high',
    reason: 'Type incompatibility or trying to perform an invalid operation on a data type',
  },

  // ── Runtime Error ──
  {
    category: 'runtime_error',
    patterns: [
      /ReferenceError/i,
      /RangeError/i,
      /URIError/i,
      /EvalError/i,
      /is\s+not\s+defined/i,
      /Maximum\s+call\s+stack/i,
      /stack\s+overflow/i,
    ],
    confidence: 'medium',
    reason: 'Error indicates a runtime JavaScript exception',
  },
];

// ─── Classification Engine ─────────────────────────────────────────

/**
 * Classify a normalized failure using heuristic pattern matching.
 *
 * The classifier checks the error message against ordered rules.
 * The first matching rule determines the category. If no rule
 * matches, the failure is classified as 'unknown'.
 *
 * @param failure - Normalized failure data
 * @returns Classification with category, confidence, and reasoning
 */
export function classifyFailure(failure: NormalizedFailure): Classification {
  const searchText = [
    failure.errorMessage,
    failure.rawError,
    // Include relevant stack frame info for context
    ...failure.stackFrames
      .filter((f) => !f.isExternal)
      .slice(0, 3)
      .map((f) => `${f.functionName} ${f.filePath}`),
  ].join('\n');

  // Try each rule in priority order
  for (const rule of DETECTION_RULES) {
    const matchedPatterns: string[] = [];

    for (const pattern of rule.patterns) {
      if (pattern.test(searchText)) {
        matchedPatterns.push(pattern.source);
      }
    }

    if (matchedPatterns.length > 0) {
      // Boost confidence if multiple patterns match
      const confidence: Confidence =
        matchedPatterns.length >= 2 ? 'high' : rule.confidence;

      return {
        category: rule.category,
        confidence,
        reason: rule.reason,
        matchedPatterns,
      };
    }
  }

  // No pattern matched — classify as unknown
  return {
    category: 'unknown',
    confidence: 'low',
    reason: 'No known failure pattern matched',
    matchedPatterns: [],
  };
}

/**
 * Enrich a normalized failure with classification data.
 *
 * @param failure - Normalized failure
 * @returns Classified failure with detection metadata
 */
export function detectFailure(failure: NormalizedFailure): ClassifiedFailure {
  const classification = classifyFailure(failure);
  return {
    ...failure,
    classification,
  };
}

/**
 * Classify an array of normalized failures.
 */
export function detectFailures(
  failures: NormalizedFailure[]
): ClassifiedFailure[] {
  return failures.map(detectFailure);
}
