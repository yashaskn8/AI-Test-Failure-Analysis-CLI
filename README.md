# Test Intel

> AI-powered test failure analysis CLI tool

Test Intel runs your Vitest test files, captures failures, classifies them using heuristics, and generates human-readable explanations with suggested fixes — powered by AI.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run against sample failing tests
npx tsx src/cli.ts tests/sample-failing/sample.test.ts

# Or with verbose output
npx tsx src/cli.ts tests/sample-failing/sample.test.ts --verbose
```

## 🏗️ Architecture

The tool implements a modular pipeline:

```
┌──────────┐   ┌────────────┐   ┌──────────┐   ┌────────┐   ┌───────────┐
│ Collector │──▶│ Normalizer │──▶│ Detector │──▶│ Prompt │──▶│ Explainer │
│           │   │            │   │          │   │Builder │   │           │
│ Run tests │   │ Clean logs │   │ Classify │   │ Build  │   │ Generate  │
│ via Vitest│   │ Parse stack│   │ failures │   │ context│   │ AI output │
└──────────┘   └────────────┘   └──────────┘   └────────┘   └───────────┘
```

### Modules

| Module | Purpose |
|--------|---------|
| **Collector** | Runs Vitest with JSON reporter, captures structured results |
| **Normalizer** | Cleans ANSI codes, parses V8 stack traces, filters noise |
| **Detector** | Heuristic classification: timeout, syntax, runtime, assertion, dependency |
| **Prompt Builder** | Constructs token-efficient LLM prompts with relevant context |
| **Explainer** | LLM interaction (mock by default, real API via env vars) |
| **CLI** | Orchestrates pipeline, colorized terminal output |

## 📁 Project Structure

```
packages/cli/
├── bin/
│   └── test-intel.js          # CLI executable entry point
├── src/
│   ├── collector/index.ts     # Test execution & result capture
│   ├── normalizer/index.ts    # Log cleaning & stack trace parsing
│   ├── detector/index.ts      # Failure classification heuristics
│   ├── prompt/index.ts        # LLM prompt construction
│   ├── explainer/index.ts     # AI explanation generation
│   ├── types.ts               # Shared TypeScript interfaces
│   └── cli.ts                 # CLI entry point & display
├── tests/
│   ├── sample-failing/        # Sample tests designed to fail
│   └── unit/                  # Unit tests for each module
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_ENABLE` | `false` | Set to `true` for real AI analysis |
| `OPENAI_API_KEY` | — | API key (required when LLM enabled) |
| `LLM_API_BASE` | `https://api.openai.com/v1` | Custom API endpoint |
| `LLM_MODEL` | `gpt-4o-mini` | Model to use |

### Example with real AI:

```bash
export LLM_ENABLE=true
export OPENAI_API_KEY=sk-...
npx tsx src/cli.ts your-tests.test.ts
```

## 🧪 Running Tests

```bash
# Run unit tests
npm test

# Watch mode
npm run test:watch

# Run sample failing tests through the CLI
npm run test:sample
```

## 🔧 Development

```bash
# Type-check without building
npm run lint

# Build production output
npm run build

# Run from source (development)
npx tsx src/cli.ts <test-file>
```

## 📋 Failure Categories

| Category | Triggers |
|----------|----------|
| **Timeout** | `timed out`, `timeout exceeded`, `hook timeout` |
| **Syntax Error** | `SyntaxError`, `Unexpected token`, `Cannot use import` |
| **Runtime Error** | `TypeError`, `ReferenceError`, `is not a function` |
| **Assertion Failure** | `AssertionError`, `expected/received`, `toBe`, `toEqual` |
| **Dependency Error** | `Cannot find module`, `ERR_MODULE_NOT_FOUND` |

## License

MIT
