/**
 * CLI Entry Point — test-intel
 *
 * Orchestrates the full analysis pipeline:
 * Collect → Normalize → Detect → Prompt → Explain → Display
 *
 * Features:
 * - Colorized, structured terminal output
 * - Clean error handling with user-friendly messages
 * - Configurable verbosity
 * - Exit codes that reflect test status
 */

import { resolve } from 'node:path';
import { collectTestResults } from './collector/index.js';
import { normalizeFailures } from './normalizer/index.js';
import { hydrateFailures } from './context/index.js';
import { detectFailures } from './detector/index.js';
import { buildPrompt } from './prompt/index.js';
import { explain } from './explainer/index.js';
import type { AnalysisResult, ClassifiedFailure } from './types.js';

// ─── Color Utilities (inline for zero-dep simplicity) ──────────────

// ANSI color codes for terminal output
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
};

// ─── Display Helpers ───────────────────────────────────────────────

function printBanner(): void {
  console.log('');
  console.log(
    `${c.bold}${c.cyan}  ╔══════════════════════════════════════╗${c.reset}`
  );
  console.log(
    `${c.bold}${c.cyan}  ║     🔍 TEST INTEL — Failure Analyzer ║${c.reset}`
  );
  console.log(
    `${c.bold}${c.cyan}  ╚══════════════════════════════════════╝${c.reset}`
  );
  console.log('');
}

function printDivider(): void {
  console.log(
    `${c.dim}  ──────────────────────────────────────────────${c.reset}`
  );
}

function printSuccess(msg: string): void {
  console.log(`  ${c.green}✓${c.reset} ${msg}`);
}

function printError(msg: string): void {
  console.log(`  ${c.red}✗${c.reset} ${msg}`);
}

function printInfo(msg: string): void {
  console.log(`  ${c.blue}ℹ${c.reset} ${msg}`);
}

function printWarning(msg: string): void {
  console.log(`  ${c.yellow}⚠${c.reset} ${msg}`);
}

function printLabel(label: string, value: string): void {
  console.log(`  ${c.dim}${label}:${c.reset} ${value}`);
}

/**
 * Get the category badge with appropriate color.
 */
function getCategoryBadge(category: string): string {
  const badges: Record<string, string> = {
    timeout: `${c.bgYellow}${c.bold} TIMEOUT ${c.reset}`,
    syntax_error: `${c.bgRed}${c.bold} SYNTAX ERROR ${c.reset}`,
    runtime_error: `${c.bgRed}${c.bold} RUNTIME ERROR ${c.reset}`,
    type_error: `${c.bgRed}${c.bold} TYPE ERROR ${c.reset}`,
    assertion_failure: `${c.bgMagenta}${c.bold} ASSERTION FAILURE ${c.reset}`,
    dependency_error: `${c.bgBlue}${c.bold} DEPENDENCY ERROR ${c.reset}`,
    mock_error: `${c.bgYellow}${c.bold} MOCK ERROR ${c.reset}`,
    unhandled_rejection: `${c.bgMagenta}${c.bold} UNHANDLED REJECTION ${c.reset}`,
    unknown: `${c.dim} UNKNOWN ${c.reset}`,
  };
  return badges[category] || badges.unknown!;
}

// ─── Result Display ────────────────────────────────────────────────

function displayResult(result: AnalysisResult, index: number): void {
  const { failure, explanation } = result;

  console.log('');
  printDivider();
  console.log(
    `  ${c.bold}${c.red}Failure #${index + 1}${c.reset}  ${getCategoryBadge(failure.classification.category)}`
  );
  printDivider();

  // Test identity
  printLabel('Test', `${c.bold}${failure.testName}${c.reset}`);
  printLabel('Suite', `${c.dim}${failure.suiteName}${c.reset}`);
  printLabel('Duration', `${failure.duration}ms`);
  printLabel(
    'Confidence',
    `${failure.classification.confidence.toUpperCase()}`
  );
  console.log('');

  // Error message
  console.log(`  ${c.bold}${c.red}Error Message:${c.reset}`);
  const errorLines = failure.errorMessage.split('\n').slice(0, 10);
  for (const line of errorLines) {
    console.log(`  ${c.dim}│${c.reset} ${line}`);
  }
  console.log('');

  // Relevant stack frames
  const userFrames = failure.stackFrames.filter((f) => !f.isExternal);
  if (userFrames.length > 0) {
    console.log(`  ${c.bold}${c.yellow}Stack Trace & Context:${c.reset}`);
    for (const frame of userFrames.slice(0, 3)) {
      console.log(
        `  ${c.dim}│${c.reset} ${c.cyan}${frame.functionName}${c.reset} ${c.dim}(${frame.filePath}:${frame.line}:${frame.column})${c.reset}`
      );
      if (frame.codeContext) {
        // Render snippet visually grouped
        const snippetLines = frame.codeContext.split('\n');
        for (const line of snippetLines) {
          const isTarget = line.includes('>>');
          const fmtLine = isTarget ? `${c.bgRed}${line}${c.reset}` : `${c.dim}${line}${c.reset}`;
          console.log(`  ${c.dim}│${c.reset}   ${fmtLine}`);
        }
        console.log(`  ${c.dim}│${c.reset}`);
      }
    }
  }

  // AI Explanation
  console.log(
    `  ${c.bold}${c.green}${explanation.isMock ? '🤖 AI Analysis (Mock)' : '🤖 AI Analysis'}:${c.reset}`
  );
  console.log('');

  console.log(`  ${c.bold}Root Cause:${c.reset}`);
  wrapAndPrint(explanation.rootCause, 70);
  console.log('');

  console.log(`  ${c.bold}Suggested Fixes:${c.reset}`);
  for (let i = 0; i < explanation.suggestedFixes.length; i++) {
    console.log(
      `  ${c.green}${i + 1}.${c.reset} ${explanation.suggestedFixes[i]}`
    );
  }

  if (explanation.additionalContext) {
    console.log('');
    console.log(`  ${c.bold}Additional Context:${c.reset}`);
    wrapAndPrint(explanation.additionalContext, 70);
  }
}

/**
 * Word-wrap text and print with indentation.
 */
function wrapAndPrint(text: string, maxWidth: number): void {
  const words = text.split(/\s+/);
  let currentLine = '  ';

  for (const word of words) {
    if (currentLine.length + word.length + 1 > maxWidth + 4) {
      console.log(currentLine);
      currentLine = '  ' + word;
    } else {
      currentLine += (currentLine.trim() ? ' ' : '') + word;
    }
  }

  if (currentLine.trim()) {
    console.log(currentLine);
  }
}

// ─── Pipeline Orchestration ────────────────────────────────────────

/**
 * Run the full analysis pipeline for a given test file.
 *
 * @param testFilePath - Path to the test file to analyze
 * @returns Array of analysis results
 */
export async function runPipeline(
  testFilePath: string
): Promise<AnalysisResult[]> {
  // Step 1: Collect test results
  const collectorOutput = await collectTestResults(testFilePath);

  if (collectorOutput.failures.length === 0) {
    return [];
  }

  // Step 2: Normalize failures
  const normalized = normalizeFailures(collectorOutput.failures);

  // Step 2.5: Hydrate with source code context
  await hydrateFailures(normalized);

  // Step 3: Detect/classify failure types
  const classified = detectFailures(normalized);

  // Step 4 & 5: Build prompts and get explanations
  const results: AnalysisResult[] = [];

  for (const failure of classified) {
    const prompt = buildPrompt(failure);
    const explanation = await explain(prompt, failure.classification.category);
    results.push({ failure, explanation });
  }

  return results;
}

// ─── Main CLI Entry Point ──────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle help flag
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printBanner();
    console.log(`  ${c.bold}Usage:${c.reset} test-intel <test-file> [options]`);
    console.log('');
    console.log(`  ${c.bold}Arguments:${c.reset}`);
    console.log(`    ${c.cyan}<test-file>${c.reset}    Path to the Vitest test file to analyze`);
    console.log('');
    console.log(`  ${c.bold}Options:${c.reset}`);
    console.log(`    ${c.cyan}--help, -h${c.reset}    Show this help message`);
    console.log(`    ${c.cyan}--verbose${c.reset}     Show detailed pipeline output`);
    console.log('');
    console.log(`  ${c.bold}Environment Variables:${c.reset}`);
    console.log(`    ${c.cyan}LLM_ENABLE=true${c.reset}      Enable real LLM API calls`);
    console.log(`    ${c.cyan}OPENAI_API_KEY${c.reset}       API key for OpenAI-compatible service`);
    console.log(`    ${c.cyan}LLM_API_BASE${c.reset}         Custom API base URL`);
    console.log(`    ${c.cyan}LLM_MODEL${c.reset}            Model name (default: gpt-4o-mini)`);
    console.log('');
    console.log(`  ${c.bold}Examples:${c.reset}`);
    console.log(`    ${c.dim}$ test-intel src/utils.test.ts${c.reset}`);
    console.log(`    ${c.dim}$ LLM_ENABLE=true test-intel tests/api.test.ts${c.reset}`);
    console.log('');
    process.exit(0);
  }

  const testFilePath = args[0]!;
  const verbose = args.includes('--verbose');
  const absolutePath = resolve(testFilePath);

  printBanner();
  printInfo(`Analyzing: ${c.bold}${absolutePath}${c.reset}`);
  printInfo(
    `LLM Mode: ${
      process.env.LLM_ENABLE === 'true'
        ? `${c.green}Real API${c.reset}`
        : `${c.yellow}Mock${c.reset}`
    }`
  );
  console.log('');

  try {
    // Step 1: Collect
    if (verbose) printInfo('Running Vitest and collecting results...');
    const startTime = Date.now();
    const collectorOutput = await collectTestResults(absolutePath);
    const collectTime = Date.now() - startTime;

    if (verbose) {
      printLabel('Collection time', `${collectTime}ms`);
      printLabel('Total tests', `${collectorOutput.totalTests}`);
      printLabel('Passed', `${collectorOutput.passed}`);
      printLabel('Failed', `${collectorOutput.failed}`);
      printLabel('Skipped', `${collectorOutput.skipped}`);
    }

    // All tests passed?
    if (collectorOutput.failures.length === 0) {
      console.log('');
      printSuccess(
        `${c.bold}All tests passed!${c.reset} No failures to analyze.`
      );
      console.log('');
      process.exit(0);
    }

    // Step 2: Normalize
    if (verbose) printInfo('Normalizing failure data...');
    const normalized = normalizeFailures(collectorOutput.failures);

    // Step 2.5: Hydrate with source code context
    if (verbose) printInfo('Extracting source code context...');
    await hydrateFailures(normalized);

    // Step 3: Detect
    if (verbose) printInfo('Classifying failure types...');
    const classified = detectFailures(normalized);

    // Summary header
    console.log(
      `  ${c.bold}${c.red}Found ${classified.length} failing test(s)${c.reset}`
    );

    // Step 4 & 5: Build prompts and explain
    if (verbose) printInfo('Generating AI explanations...');

    const results: AnalysisResult[] = [];
    for (const failure of classified) {
      const prompt = buildPrompt(failure);

      if (verbose) {
        printLabel('Estimated tokens', `${prompt.estimatedTokens}`);
      }

      const explanation = await explain(
        prompt,
        failure.classification.category
      );
      results.push({ failure, explanation });
    }

    // Step 6: Display results
    for (let i = 0; i < results.length; i++) {
      displayResult(results[i]!, i);
    }

    // Summary footer
    console.log('');
    printDivider();
    console.log(
      `  ${c.bold}Summary:${c.reset} ${c.red}${results.length} failure(s)${c.reset} analyzed in ${Date.now() - startTime}ms`
    );

    const categories = results.map(
      (r) => r.failure.classification.category
    );
    const uniqueCategories = [...new Set(categories)];
    console.log(
      `  ${c.bold}Categories:${c.reset} ${uniqueCategories
        .map((cat) => getCategoryBadge(cat))
        .join(' ')}`
    );

    if (results.some((r) => r.explanation.isMock)) {
      console.log('');
      printWarning(
        `Using mock AI responses. Set ${c.cyan}LLM_ENABLE=true${c.reset} for real analysis.`
      );
    }

    console.log('');
    process.exit(1); // Exit with error code since tests failed
  } catch (error) {
    console.log('');
    const message = error instanceof Error ? error.message : String(error);
    printError(`${c.bold}Pipeline Error:${c.reset} ${message}`);

    if (verbose && error instanceof Error && error.stack) {
      console.log(`  ${c.dim}${error.stack}${c.reset}`);
    }

    console.log('');
    printInfo(
      'Troubleshooting: Ensure Vitest is installed and the test file exists.'
    );
    console.log('');
    process.exit(2);
  }
}

// Run if this is the entry point
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
