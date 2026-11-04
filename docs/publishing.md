# Publishing checklist

Everything below runs from the repository root. The first block is a one-time setup; the rest is what every release repeats.

## 1. Create the public repository and push `main`

```bash
gh repo create jumilandelapena/ai-code-review-action --public --source . --remote origin --push \
  --description "Reusable GitHub Action: reviews every pull request with Claude and posts one review with inline comments, suggested fixes and a summary."
```

If the repository already exists (for example it was created private), push instead:

```bash
git remote add origin https://github.com/jumilandelapena/ai-code-review-action.git   # skip if already set
git push -u origin main
gh repo edit jumilandelapena/ai-code-review-action --visibility public --accept-visibility-change-consequences
```

## 2. Add the API key secret

```bash
gh secret set ANTHROPIC_API_KEY --repo jumilandelapena/ai-code-review-action
```

The command prompts for the value. Nothing in the workflows prints it; the action masks it with `core.setSecret`.

## 3. Open the two demo pull requests (they stay open on purpose)

```bash
git push origin demo/retry-helper demo/cost-budget

gh pr create --base main --head demo/retry-helper \
  --title "feat(github): retry transient GitHub API failures with exponential backoff" \
  --body "Adds \`withRetry\` and wraps \`listFiles\` and \`createReview\` with it (3 attempts, 500 ms base delay, doubling).

Demo PR for the AI review: this change contains two planted bugs. It is never merged."

gh pr create --base main --head demo/cost-budget \
  --title "feat: max_cost_usd input caps spend per run" \
  --body "Adds a \`BudgetTracker\` that projects the input cost of each batch before it is sent and stops the run once the cap would be crossed. New input \`max_cost_usd\` (default 0 = unlimited).

Demo PR for the AI review: this change contains two planted bugs. It is never merged."
```

Opening the PRs triggers `self-review.yml`. If the secret was added after the PRs were opened, ask for a review on demand:

```bash
gh pr comment 1 --body "/ai-review"
gh pr comment 2 --body "/ai-review"
```

Planted bugs, for checking the reviews against:

| PR | File | Bug |
| --- | --- | --- |
| #1 | `src/github/retry.ts` | `attempt <= options.attempts + 1` makes one more attempt than configured, and the `attempt === options.attempts` break never fires on the last loop. |
| #1 | `src/github/octokit.ts` | `createReview` is a non-idempotent POST; retrying it after a timeout can post the same review twice. |
| #2 | `src/budget.ts` | `provider.countTokens(request)` is not awaited; the Promise is cast to a number, so the projection is `NaN` and the cap never trips. |
| #2 | `src/budget.ts` | `projectedInputCost` divides by `1_000` instead of `1_000_000`; the estimate is 1000× too high. |

## 4. Tag and release

```bash
git tag -a v1.0.0 -m "v1.0.0"
git tag -f v1 v1.0.0
git push origin v1.0.0
git push -f origin v1
gh release create v1.0.0 --title "v1.0.0" --notes-file docs/releases/v1.0.0.md
```

`v1` is the moving tag that `uses: jumilandelapena/ai-code-review-action@v1` follows. Move it after every `1.x` release with `git tag -f v1 vX.Y.Z && git push -f origin v1`.

To list the action on the GitHub Marketplace, open the release page in the browser and tick *Publish this Action to the GitHub Marketplace*; that step has no CLI.

## 5. Real eval numbers and the README screenshot

Both need `ANTHROPIC_API_KEY` locally (put it in `.env`).

```bash
pnpm eval                                                             # rewrites docs/eval-results.md with real-model numbers
GITHUB_TOKEN=$(gh auth token) pnpm screenshot --repo jumilandelapena/ai-code-review-action --pr 1   # writes docs/example-review.png
git add docs/eval-results.md docs/example-review.png
git commit -m "docs: real-model eval results and review screenshot"
git push
git tag -a v1.0.1 -m "v1.0.1: docs" && git tag -f v1 v1.0.1 && git push origin v1.0.1 && git push -f origin v1
```

Then copy the Summary table from `docs/eval-results.md` into the README's Evals section.
