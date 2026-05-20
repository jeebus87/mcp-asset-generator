import OpenAI from "openai";

export class GenerationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

export function classifyApiError(
  error: unknown,
  promptContext?: string
): GenerationError {
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    const body = error.error as Record<string, unknown> | undefined;
    const errorCode =
      (body?.error as Record<string, unknown>)?.code ??
      (body as Record<string, unknown>)?.code;

    // Content policy rejection
    if (
      status === 400 &&
      (String(errorCode) === "content_policy_violation" ||
        error.message.toLowerCase().includes("content policy") ||
        error.message.toLowerCase().includes("safety"))
    ) {
      return new GenerationError(
        `Content policy rejection: Your prompt was flagged by OpenAI's safety system.\n` +
          `Triggering prompt: "${promptContext ?? "(unknown)"}"\n\n` +
          `To fix: Rephrase your prompt to avoid content that may violate OpenAI's usage policies.\n` +
          `See: https://platform.openai.com/docs/guides/moderation`,
        "content_policy",
        { prompt: promptContext, status }
      );
    }

    // Rate limiting
    if (status === 429) {
      const retryAfter = error.headers?.["retry-after"];
      const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
      return new GenerationError(
        `Rate limit exceeded. You've made too many image generation requests.\n\n` +
          `Retry after: ${waitSeconds} seconds\n` +
          `Tip: Use quality "low" for drafts to reduce API usage.\n` +
          `If this persists, check your rate limits at: https://platform.openai.com/settings/organization/limits`,
        "rate_limit",
        { retryAfterSeconds: waitSeconds, status }
      );
    }

    // Auth errors
    if (status === 401) {
      return new GenerationError(
        `Authentication failed (401). Your OpenAI API key is invalid or expired.\n\n` +
          `To fix:\n` +
          `1. Check your OPENAI_API_KEY environment variable\n` +
          `2. Generate a new key at: https://platform.openai.com/api-keys\n` +
          `3. Ensure the key has image generation permissions`,
        "auth_error",
        { status }
      );
    }

    // Org verification / billing
    if (status === 403) {
      return new GenerationError(
        `Access denied (403). Your OpenAI organization may need verification or has billing issues.\n\n` +
          `To fix:\n` +
          `1. Verify your organization: https://platform.openai.com/settings/organization/billing\n` +
          `2. Check that image generation is enabled for your API key\n` +
          `3. Ensure your account has sufficient credits`,
        "billing_error",
        { status }
      );
    }

    // Billing / payment
    if (status === 402) {
      return new GenerationError(
        `Payment required (402). Your OpenAI account has insufficient credits.\n\n` +
          `To fix: Add credits at https://platform.openai.com/settings/organization/billing`,
        "billing_error",
        { status }
      );
    }

    // Generic API error
    return new GenerationError(
      `OpenAI API error (${status}): ${error.message}`,
      "api_error",
      { status }
    );
  }

  // Non-API errors
  if (error instanceof Error) {
    return new GenerationError(error.message, "unknown", {});
  }

  return new GenerationError(String(error), "unknown", {});
}
