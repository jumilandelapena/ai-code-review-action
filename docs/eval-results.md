# Eval results

Provider: `mock` · Model: `claude-opus-5-5` · Effort: `medium` · Cases: 13 (12 with a planted bug, 1 clean) · Run: 2026-11-04

> **Mock provider.** No model was called: every number below comes from the fixed mock finding (first added line of the file). These results only prove the harness runs. Set `ANTHROPIC_API_KEY` and run `pnpm eval` for real numbers.

## Summary

| Metric | Value |
| --- | --- |
| Recall, planted bug reported on the exact line | 0/12 (0.0%) |
| Recall, within ±2 lines | 0/12 (0.0%) |
| Exact hits with a matching category | 0/12 (0.0%) |
| False positives on the clean diff | 1 |
| Average findings per diff | 1.00 |
| Average cost per review | $0.0000 |
| Total cost | $0.0000 |
| Tokens | 17,880 in / 0 out / 0 cache read / 0 cache write |
| Share of input served from the prompt cache | 0.0% |
| Incomplete reviews (refusal, max_tokens, parse error) | 0 |

## Per case

| Case | Planted bug | Found | Expected line | Reported lines | Findings | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| `clean-refactor` | none (clean diff) | ❌ 1 false positive(s) | – | 6 | 1 | $0.0000 |
| `missing-await` | bug/security/correctness | ❌ missed | 20 | 12 | 1 | $0.0000 |
| `null-deref` | bug/correctness | ❌ missed | 24 | 15 | 1 | $0.0000 |
| `off-by-one` | bug/correctness | ❌ missed | 16 | 6 | 1 | $0.0000 |
| `path-traversal` | security | ❌ missed | 24 | 6 | 1 | $0.0000 |
| `race-condition` | bug/correctness | ❌ missed | 29 | 20 | 1 | $0.0000 |
| `resource-leak` | bug/performance/correctness | ❌ missed | 31 | 9 | 1 | $0.0000 |
| `secret-in-code` | security | ❌ missed | 15 | 1 | 1 | $0.0000 |
| `sql-injection` | security | ❌ missed | 22 | 9 | 1 | $0.0000 |
| `unhandled-error` | bug/correctness | ❌ missed | 29 | 10 | 1 | $0.0000 |
| `wrong-comparison` | bug/security/correctness | ❌ missed | 19 | 8 | 1 | $0.0000 |
| `wrong-units` | bug/security/correctness | ❌ missed | 28 | 9 | 1 | $0.0000 |
| `xss` | security | ❌ missed | 19 | 8 | 1 | $0.0000 |

## Findings per case

### clean-refactor

_Extract slug generation into a helper and handle unicode_ — verdict/status: `comment`

- **medium** · bug · `src/slug.ts:6`: Mock finding on the first changed line

### missing-await

_Validate session tokens before serving account data_ — verdict/status: `comment`

- **medium** · bug · `src/account-handler.ts:12`: Mock finding on the first changed line

### null-deref

_Send a welcome email after signup_ — verdict/status: `comment`

- **medium** · bug · `src/welcome.ts:15`: Mock finding on the first changed line

### off-by-one

_Add page slicing to the list endpoint_ — verdict/status: `comment`

- **medium** · bug · `src/pagination.ts:6`: Mock finding on the first changed line

### path-traversal

_Serve uploaded attachments by file name_ — verdict/status: `comment`

- **medium** · bug · `src/attachments.ts:6`: Mock finding on the first changed line

### race-condition

_Add withdraw() to the wallet service_ — verdict/status: `comment`

- **medium** · bug · `src/wallet.ts:20`: Mock finding on the first changed line

### resource-leak

_Add a bulk insert for imported orders_ — verdict/status: `comment`

- **medium** · bug · `src/orders-import.ts:9`: Mock finding on the first changed line

### secret-in-code

_Wire up the payment client for checkout_ — verdict/status: `comment`

- **medium** · bug · `src/payments.ts:1`: Mock finding on the first changed line

### sql-injection

_Add search by name to the users repository_ — verdict/status: `comment`

- **medium** · bug · `src/users-repo.ts:9`: Mock finding on the first changed line

### unhandled-error

_Accept webhook deliveries from the billing provider_ — verdict/status: `comment`

- **medium** · bug · `src/webhook.ts:10`: Mock finding on the first changed line

### wrong-comparison

_Restrict the admin panel to allowed roles_ — verdict/status: `comment`

- **medium** · bug · `src/authorize.ts:8`: Mock finding on the first changed line

### wrong-units

_Reject expired JWTs in the auth middleware_ — verdict/status: `comment`

- **medium** · bug · `src/jwt-expiry.ts:9`: Mock finding on the first changed line

### xss

_Show the commenter's name above each comment_ — verdict/status: `comment`

- **medium** · bug · `src/ui/comment-card.ts:8`: Mock finding on the first changed line

## How to reproduce

```bash
pnpm eval                      # real model (needs ANTHROPIC_API_KEY)
LLM_PROVIDER=mock pnpm eval    # harness smoke test, no key
```

Scoring: a planted bug counts as found when any validated finding (inline or file-level note) points at the exact line that `case.json` names via `line_contains`. Cases run one after another so every request after the first reads the system prompt from the prompt cache.
