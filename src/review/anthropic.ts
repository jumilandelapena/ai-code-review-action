import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ReviewOutputSchema } from "./schema.js";
import type {
  CountTokensInput,
  ReviewProvider,
  ReviewRequest,
  ReviewResult,
  TokenUsage,
} from "./provider.js";

/**
 * Real reviewer: one `messages.parse` call per batch with structured output.
 *
 * - The system prompt carries `cache_control` so every batch in a run shares one
 *   cached prefix (the diff is the only thing that changes between batches).
 * - No `thinking` parameter: Claude Opus 5.5 thinks adaptively by default and
 *   rejects `budget_tokens`. Depth is controlled with `output_config.effort`.
 * - No `tool_choice`: structured outputs replace the old "force a tool" trick.
 */
export class AnthropicReviewProvider implements ReviewProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly format = zodOutputFormat(ReviewOutputSchema);

  constructor(apiKey: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 3 });
  }

  async countTokens(input: CountTokensInput): Promise<number> {
    const params: Anthropic.MessageCountTokensParams = {
      model: input.model,
      messages: [{ role: "user", content: input.user }],
    };
    if (input.system !== undefined) params.system = input.system;
    const result = await this.client.messages.countTokens(params);
    return result.input_tokens;
  }

  async review(request: ReviewRequest): Promise<ReviewResult> {
    let response: Awaited<ReturnType<typeof this.send>>;
    try {
      response = await this.send(request);
    } catch (error) {
      if (error instanceof Anthropic.APIError) throw error;
      if (error instanceof Anthropic.AnthropicError) {
        // `messages.parse` throws when the JSON is incomplete, which is what a
        // response cut off at `max_tokens` looks like. Usage is not recoverable here.
        return {
          status: "incomplete",
          reason: "parse_error",
          detail: `structured output could not be parsed (usually truncated at max_tokens): ${error.message.split("\n")[0]}`,
          usage: zeroUsage(),
        };
      }
      throw error;
    }

    const usage = toUsage(response.usage);
    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.type === "refusal" ? response.stop_details.category : null;
      return {
        status: "incomplete",
        reason: "refusal",
        detail: category ? `the model declined to review this batch (category: ${category})` : "the model declined to review this batch",
        usage,
      };
    }
    if (response.stop_reason === "max_tokens") {
      return {
        status: "incomplete",
        reason: "max_tokens",
        detail: "the response hit max_tokens before the review was complete",
        usage,
      };
    }
    if (response.parsed_output === null) {
      return {
        status: "incomplete",
        reason: "empty",
        detail: `the model returned no structured output (stop_reason: ${response.stop_reason ?? "unknown"})`,
        usage,
      };
    }
    return { status: "ok", output: response.parsed_output, usage };
  }

  private send(request: ReviewRequest) {
    return this.client.messages.parse({
      model: request.model,
      max_tokens: request.maxTokens,
      system: [
        {
          type: "text",
          text: request.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: request.user }],
      output_config: {
        format: this.format,
        effort: request.effort,
      },
    });
  }
}

function toUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function zeroUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}
