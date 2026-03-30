/**
 * Sample Failing Tests
 *
 * These tests are intentionally designed to fail in different ways,
 * exercising each failure category that the detector can classify.
 * Use these with: npx tsx src/cli.ts tests/sample-failing/sample.test.ts
 */

import { describe, it, expect } from 'vitest';

// ─── Assertion Failure ───────────────────────────────────────────
describe('Math utilities', () => {
  it('should add two numbers correctly', () => {
    const result = 2 + 2;
    // Intentionally wrong expectation
    expect(result).toBe(5);
  });

  it('should multiply correctly', () => {
    const result = 3 * 7;
    expect(result).toEqual(22);
  });
});

// ─── Runtime Error ──────────────────────────────────────────────
describe('Object processing', () => {
  it('should access nested properties safely', () => {
    const data: Record<string, unknown> = { user: null };
    // This will throw: Cannot read properties of null
    const name = (data.user as { profile: { name: string } }).profile.name;
    expect(name).toBe('Alice');
  });
});

// ─── Reference Error ───────────────────────────────────────────
describe('Variable scoping', () => {
  it('should reference defined variables', () => {
    // @ts-expect-error — intentional: testing undefined variable
    const value = undeclaredVariable + 1;
    expect(value).toBe(42);
  });
});

// ─── Type Error ─────────────────────────────────────────────────
describe('Function calls', () => {
  it('should call functions correctly', () => {
    const notAFunction = 42;
    // This will throw: notAFunction is not a function
    // @ts-expect-error — intentional: testing non-function call
    const result = notAFunction();
    expect(result).toBe(42);
  });
});
