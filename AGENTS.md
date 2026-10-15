# AGENTS.md - Fintech & Zenmoney MCP Guidelines

This file governs autonomous agents, IDE assistants, and Antigravity execution loops operating within this repository. 

---

## 1. Domain & Engineering Invariants (Fintech Rules)

1. **Zero Native Floating-Point Math for Money**
   - NEVER use raw JavaScript `number` arithmetic (`+`, `-`, `*`, `/`) for money, account balances, fees, interest rates, or currency conversions.
   - Use arbitrary-precision libraries (`decimal.js`, `bignumber.js`) or integer minor currency units (cents, satoshis, micros).
   - In comparisons, always use `.equals()`, `.greaterThan()`, or `.lessThan()` rather than standard comparison operators.

2. **Strict Boundary Validation**
   - Every payload crossing process, network, or MCP boundaries MUST be strictly validated at runtime using `zod` (or project equivalent).
   - Never trust raw MCP responses or external webhook payloads implicitly without schema parsing.

3. **Database & State Machine Integrity**
   - Ledger state transitions must follow explicit states: `DRAFT` -> `PENDING` -> `SETTLED` / `FAILED`.
   - Never perform destructive database migrations without producing a dry-run SQL diff first.
   - All financial writes must include idempotency identifiers to prevent duplicate debits/credits.

---

## 2. Zenmoney MCP Integration Protocols

The environment connects to a Zenmoney MCP server (`zenmoney-mcp`) exposing tools such as `sync_data`, `list_accounts`, `list_transactions`, `add_expense`, `add_income`, `add_transfer`, `update_transaction`, and `suggest_category`.

### A. The "Sync-First" Read Principle
- Zenmoney caches data locally and synchronizes periodically with the upstream API.
- Before reading balances, checking categories, or answering transaction-related queries, agents **MUST verify if a sync is required** or run `sync_data` if real-time accuracy is needed.

### B. Mutating Actions Require Explicit Confirmation
- **Read-only tools** (`list_accounts`, `list_transactions`, `list_categories`, `suggest_category`, `get_budgets`):
  - Can be invoked autonomously to gather context, inspect transaction logs, or compute financial reports.
- **Mutating tools** (`add_expense`, `add_income`, `add_transfer`, `update_transaction`, `delete_transaction`):
  - **CANNOT be executed silently.**
  - Always outline the proposed transaction payload to the user first:
    * Amount & Currency
    * Source / Target Account
    * Category & Payee
    * Date and Comment
  - Request user confirmation before invoking write/delete tool calls unless explicitly instructed with an auto-commit directive.

### C. Multi-Currency Transfers
- When calling `add_transfer`, ensure both debit and credit amounts and currencies are explicitly accounted for (e.g., USD -> EUR conversion fees/rates). Never assume a 1:1 parity across different accounts.

### D. Category Disambiguation
- When categorizing transactions, call `suggest_category` or `list_categories` before guessing a category ID. Never invent ad-hoc category names not present in the user's category tree.

---

## 3. Autonomous Execution & Verification Workflow

When tasks are handed off in Antigravity or CLI harnesses:

1. **Discovery & Exploration**
   - Read local configuration, test harnesses, and type definitions first.
   - Do NOT execute broad recursive searches that sweep across `node_modules/`, `.next/`, `dist/`, or lockfiles.

2. **Implementation & Refactoring**
   - Maintain strict typing throughout (`noImplicitAny`, strict null checks).
   - Do not weaken TypeScript configurations (`as any`, `@ts-ignore`) to bypass compilation errors. Fix the underlying types or schema definitions.

3. **Automated Verification Loop**
   - After modifying TypeScript files, run the test/typecheck suite:
     ```bash
     pnpm typecheck # or npm run typecheck
     pnpm test      # or npm test
     ```
   - If tests fail, inspect the stack trace, correct the implementation, and re-run verification before completing the session.

---

## 4. MCP Credentials & Security Boundaries

- Never hardcode Zenmoney OAuth tokens (`ZENMONEY_TOKEN`, `ZENMONEY_ACCESS_TOKEN`, `ZENMONEY_REFRESH_TOKEN`) or credentials into repo files, logs, or git commits.
- Token resolution must always follow secure environment variable or OS credential store injection.
- Redact bank account numbers, IBANs, and sensitive personal identifiers from test outputs and logs.
