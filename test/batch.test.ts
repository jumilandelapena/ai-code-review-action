import { describe, expect, it } from "vitest";
import { planBatches, splitBatch, type RenderedFile } from "../src/review/batch.js";

function rendered(name: string, tokens: number, tokensWithoutContext = tokens): RenderedFile {
  return {
    filename: name,
    text: `${name}:with`,
    tokens,
    textWithoutContext: `${name}:without`,
    tokensWithoutContext,
    firstAddedLine: 1,
    firstAddedContent: "x",
  };
}

describe("planBatches", () => {
  it("keeps every batch under the budget after the fixed prompt is paid", () => {
    const files = [rendered("a", 300), rendered("b", 300), rendered("c", 300), rendered("d", 100)];
    const plan = planBatches(files, 1000, 200);
    expect(plan.skipped).toEqual([]);
    expect(plan.batches.map((b) => b.map((f) => f.filename))).toEqual([["a", "b"], ["c", "d"]]);
    for (const batch of plan.batches) {
      const total = 200 + batch.reduce((sum, f) => sum + f.tokens, 0);
      expect(total).toBeLessThanOrEqual(1000);
    }
  });

  it("puts a large PR into many batches and never exceeds the budget", () => {
    const files = Array.from({ length: 50 }, (_, i) => rendered(`f${i}`, 50 + (i % 7) * 40));
    const budget = 600;
    const plan = planBatches(files, budget, 100);
    const names = plan.batches.flat().map((f) => f.filename);
    expect(names).toEqual(files.map((f) => f.filename));
    expect(plan.batches.length).toBeGreaterThan(5);
    for (const batch of plan.batches) {
      expect(100 + batch.reduce((sum, f) => sum + f.tokens, 0)).toBeLessThanOrEqual(budget);
    }
  });

  it("drops context lines for a file that only fits without them", () => {
    const plan = planBatches([rendered("big", 900, 400)], 1000, 200);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.[0]).toMatchObject({ text: "big:without", tokens: 400 });
  });

  it("skips a file whose diff alone exceeds the budget and says why", () => {
    const plan = planBatches([rendered("huge", 2000, 1500), rendered("ok", 100)], 1000, 200);
    expect(plan.batches).toEqual([[rendered("ok", 100)]]);
    expect(plan.skipped[0]?.filename).toBe("huge");
    expect(plan.skipped[0]?.reason).toContain("1500 tokens");
  });

  it("skips everything when the fixed prompt alone is over budget", () => {
    const plan = planBatches([rendered("a", 10)], 100, 150);
    expect(plan.batches).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain("smaller than the fixed prompt");
  });

  it("splitBatch halves a batch", () => {
    expect(splitBatch([rendered("a", 1), rendered("b", 1), rendered("c", 1)]).map((b) => b.length)).toEqual([2, 1]);
  });
});
