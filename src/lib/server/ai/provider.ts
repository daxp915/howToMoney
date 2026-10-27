// The AI layer sits behind this interface so the categorization backend is a
// swap, not a rewrite. Claude today; a local Ollama model keeps every merchant
// descriptor inside the house if that tradeoff ever changes.

export interface ClassifyInput {
  /** Stable index so results can be reassociated regardless of return order. */
  index: number;
  /** Raw bank descriptor, warts and all -- the model needs the noise to disambiguate. */
  description: string;
  /** Negative = money out. Sign and size are strong category signals. */
  amount: string;
  accountType: string;
}

export interface ClassifyOutput {
  index: number;
  /** Human-readable merchant, e.g. "Blue Bottle Coffee". */
  merchant: string;
  /** Must be one of the supplied category names, or null when genuinely unclear. */
  category: string | null;
  /** 0-1. Anything under REVIEW_CONFIDENCE goes to the user, not to the ledger. */
  confidence: number;
  /** True when the descriptor itself identifies a recurring subscription. */
  isSubscription: boolean;
}

export interface ClassifyUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
}

export interface ClassifyResponse {
  results: ClassifyOutput[];
  usage: ClassifyUsage;
}

export interface CategorizationProvider {
  readonly name: string;
  classify(items: ClassifyInput[], categoryNames: string[]): Promise<ClassifyResponse>;
}

/** No-op provider: layers 1 and 2 still run, everything unknown goes to review. */
export class NullProvider implements CategorizationProvider {
  readonly name = 'none';
  async classify(items: ClassifyInput[]): Promise<ClassifyResponse> {
    return {
      results: items.map((i) => ({
        index: i.index,
        merchant: i.description,
        category: null,
        confidence: 0,
        isSubscription: false
      })),
      usage: { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 }
    };
  }
}

export async function getProvider(): Promise<CategorizationProvider> {
  const which = (process.env.AI_PROVIDER ?? 'claude').toLowerCase();
  if (which === 'none') return new NullProvider();
  if (which === 'claude') {
    const { ClaudeProvider } = await import('./claude');
    return new ClaudeProvider();
  }
  if (which === 'ollama') {
    throw new Error(
      'AI_PROVIDER=ollama is declared in the interface but not implemented yet. ' +
        'Add src/lib/server/ai/ollama.ts implementing CategorizationProvider.'
    );
  }
  throw new Error(`Unknown AI_PROVIDER: ${which}`);
}
