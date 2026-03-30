/**
 * Collector Module
 *
 * Responsible for executing Vitest in a child process with JSON reporter,
 * capturing the structured output, and extracting failing test results.
 *
 * Design decisions:
 * - Uses Node.js to run Vitest's CLI module directly (cross-platform)
 * - Runs Vitest with `--reporter=json` for structured, parseable output
 * - Falls back to stderr parsing if JSON output is malformed
 * - Applies a generous timeout to avoid hung processes
 */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { CollectorOutput, RawTestResult } from '../types.js';

/** Maximum time to wait for Vitest to complete (ms) */
const VITEST_TIMEOUT = 60_000;

/**
 * Resolve the vitest CLI entry point.
 * Works cross-platform by finding the actual JS entry point
 * rather than relying on .cmd/.sh shims in node_modules/.bin/.
 */
function resolveVitestCli(): string {
  try {
    // Use createRequire to resolve from the current working directory
    const require = createRequire(resolve('package.json'));
    // Resolve vitest's package.json to find its installation
    const vitestPkgPath = require.resolve('vitest/package.json');
    // The CLI entry is at vitest/dist/cli-wrapper.js (Vitest v3+)
    // or vitest/vitest.mjs for older versions
    const vitestDir = resolve(vitestPkgPath, '..');
    // Use the public CLI wrapper
    return resolve(vitestDir, 'vitest.mjs');
  } catch {
    // Fallback: try the node_modules/.bin path (works on Unix-like systems)
    return resolve('node_modules', '.bin', 'vitest');
  }
}

/**
 * Run Vitest against a target file and collect structured failure data.
 *
 * @param testFilePath - Absolute or relative path to the test file
 * @returns Structured collector output with failures extracted
 */
export async function collectTestResults(
  testFilePath: string
): Promise<CollectorOutput> {
  const absolutePath = resolve(testFilePath);
  const rawOutput = await runVitest(absolutePath);
  return parseVitestOutput(rawOutput, absolutePath);
}

/**
 * Execute Vitest as a child process and capture combined stdout/stderr.
 *
 * Uses `node` (process.execPath) to run vitest's CLI module directly,
 * which avoids Windows .cmd shim issues with execFile.
 *
 * We intentionally don't reject on non-zero exit codes because failing
 * tests cause Vitest to exit with code 1 — that's expected behavior.
 */
function runVitest(testFilePath: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const vitestCli = resolveVitestCli();

    const args = [
      vitestCli,
      'run',
      testFilePath,
      '--reporter=json',
      '--no-color',
    ];

    const child = execFile(process.execPath, args, {
      timeout: VITEST_TIMEOUT,
      maxBuffer: 10 * 1024 * 1024, // 10 MB buffer for large outputs
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0' },
    }, (error, stdout, stderr) => {
      // Vitest exits with code 1 when tests fail — that's expected.
      // We only reject on actual execution errors (e.g., binary not found).
      if (error && !stdout && !stderr) {
        rejectPromise(new Error(
          `Failed to execute Vitest: ${error.message}\n` +
          `Ensure Vitest is installed: npm install -D vitest`
        ));
        return;
      }

      // Prefer stdout (JSON output), fall back to stderr
      resolvePromise(stdout || stderr || '');
    });

    // Handle process-level errors (e.g., ENOENT)
    child.on('error', (err) => {
      rejectPromise(new Error(
        `Vitest process error: ${err.message}\n` +
        `Ensure Vitest is installed: npm install -D vitest`
      ));
    });
  });
}

/**
 * Parse Vitest JSON reporter output into our structured format.
 *
 * The JSON reporter outputs a structure like:
 * {
 *   "numTotalTests": N,
 *   "numPassedTests": N,
 *   "numFailedTests": N,
 *   "testResults": [{ "assertionResults": [...] }]
 * }
 */
function parseVitestOutput(
  rawOutput: string,
  testFilePath: string
): CollectorOutput {
  // Try to extract JSON from the output (Vitest may prepend/append non-JSON text)
  const jsonMatch = rawOutput.match(/\{[\s\S]*"testResults"[\s\S]*\}/);

  if (!jsonMatch) {
    // Fallback: parse as plain text error output
    return parseTextFallback(rawOutput, testFilePath);
  }

  try {
    const json = JSON.parse(jsonMatch[0]);
    return extractFromJson(json);
  } catch {
    return parseTextFallback(rawOutput, testFilePath);
  }
}

/**
 * Extract structured results from Vitest JSON output.
 */
function extractFromJson(json: Record<string, unknown>): CollectorOutput {
  const testResults = (json.testResults as Array<Record<string, unknown>>) || [];
  const failures: RawTestResult[] = [];

  for (const suite of testResults) {
    const suiteName = (suite.name as string) || 'unknown';
    const assertions = (suite.assertionResults as Array<Record<string, unknown>>) || [];

    for (const assertion of assertions) {
      const status = assertion.status as string;
      if (status === 'failed') {
        const failureMessages = (assertion.failureMessages as string[]) || [];
        const fullMessage = failureMessages.join('\n');

        // Split error message from stack trace
        const { message, stack } = splitErrorAndStack(fullMessage);

        failures.push({
          name: (assertion.title as string) || (assertion.fullName as string) || 'unnamed test',
          suiteName,
          status: 'fail',
          duration: (assertion.duration as number) || 0,
          errorMessage: message,
          stackTrace: stack,
        });
      }
    }
  }

  return {
    totalTests: (json.numTotalTests as number) || 0,
    passed: (json.numPassedTests as number) || 0,
    failed: (json.numFailedTests as number) || 0,
    skipped: (json.numPendingTests as number) || 0,
    failures,
  };
}

/**
 * Split a combined error string into message and stack trace components.
 */
function splitErrorAndStack(raw: string): { message: string; stack: string } {
  // Look for typical V8 stack trace pattern: "    at ..."
  const stackIndex = raw.search(/\n\s+at\s+/);

  if (stackIndex === -1) {
    return { message: raw.trim(), stack: '' };
  }

  return {
    message: raw.substring(0, stackIndex).trim(),
    stack: raw.substring(stackIndex).trim(),
  };
}

/**
 * Fallback parser for when JSON output isn't available.
 * Extracts failure information from plain-text Vitest output.
 */
function parseTextFallback(
  rawOutput: string,
  testFilePath: string
): CollectorOutput {
  const lines = rawOutput.split('\n');
  const failures: RawTestResult[] = [];

  let currentTest = '';
  let errorBuffer: string[] = [];
  let inError = false;

  for (const line of lines) {
    // Detect failing test name
    const failMatch = line.match(/×|✗|FAIL\s+(.+)/);
    if (failMatch) {
      // Save previous error if exists
      if (currentTest && errorBuffer.length > 0) {
        const fullError = errorBuffer.join('\n');
        const { message, stack } = splitErrorAndStack(fullError);
        failures.push({
          name: currentTest,
          suiteName: testFilePath,
          status: 'fail',
          duration: 0,
          errorMessage: message,
          stackTrace: stack,
        });
      }
      currentTest = failMatch[1]?.trim() || line.trim();
      errorBuffer = [];
      inError = true;
      continue;
    }

    // Collect error lines
    if (inError && line.trim()) {
      errorBuffer.push(line);
    }
  }

  // Flush last error
  if (currentTest && errorBuffer.length > 0) {
    const fullError = errorBuffer.join('\n');
    const { message, stack } = splitErrorAndStack(fullError);
    failures.push({
      name: currentTest,
      suiteName: testFilePath,
      status: 'fail',
      duration: 0,
      errorMessage: message,
      stackTrace: stack,
    });
  }

  // If no structured failures found, create a single failure from raw output
  if (failures.length === 0 && rawOutput.trim().length > 0) {
    const { message, stack } = splitErrorAndStack(rawOutput);
    failures.push({
      name: 'Test execution',
      suiteName: testFilePath,
      status: 'fail',
      duration: 0,
      errorMessage: message || 'Test execution failed (see raw output)',
      stackTrace: stack,
    });
  }

  return {
    totalTests: failures.length,
    passed: 0,
    failed: failures.length,
    skipped: 0,
    failures,
    rawOutput,
  };
}

export { splitErrorAndStack, parseVitestOutput };
