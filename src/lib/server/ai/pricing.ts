/**
 * $ per million tokens, for the cost counters: the sync log's categorization
 * spend and each advisor answer's. Unknown models are priced as Opus 5, the
 * dearest of these, so a counter never under-reports.
 */
export const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 }
};

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Cache writes bill at 1.25x input and reads at 0.1x; `input_tokens`
 *  excludes both. */
export function costUsd(model: string, u: TokenUsage): number {
  const p = PRICING[model] ?? PRICING['claude-opus-5'];
  const input =
    u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  return (input / 1_000_000) * p.input + (u.output_tokens / 1_000_000) * p.output;
}
