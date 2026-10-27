import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { PRICING } from './pricing';
import type {
  CategorizationProvider,
  ClassifyInput,
  ClassifyResponse,
  ClassifyUsage
} from './provider';

const MODEL = process.env.AI_MODEL ?? 'claude-opus-5';

// Batch size trades per-call overhead against blast radius on a failed call.
// 40 keeps a call comfortably inside a few thousand tokens.
const BATCH_SIZE = 40;


const ResultSchema = z.object({
  results: z.array(
    z.object({
      index: z.number(),
      merchant: z.string(),
      category: z.string().nullable(),
      confidence: z.number(),
      isSubscription: z.boolean()
    })
  )
});

function systemPrompt(categoryNames: string[]): string {
  return [
    'You categorize personal bank and credit card transactions.',
    '',
    'For each transaction you receive a raw bank descriptor, a signed amount',
    '(negative = money leaving the account) and the account type.',
    '',
    'Return, for every input index:',
    '  merchant    - the real-world business name, cleaned of processor prefixes',
    '                (SQ *, TST*, PY *), store numbers, cities, dates and auth codes.',
    '                "SQ *BLUE BOTTLE COFF 8837 OAKLAND CA" -> "Blue Bottle Coffee".',
    '                If no business is identifiable, return the descriptor tidied up.',
    '  category    - exactly one name from the category list below, or null if you',
    '                genuinely cannot tell. Never invent a category name.',
    '  confidence  - 0 to 1, your true confidence in the category. Be honest: a low',
    '                score sends the item to a human, which is the correct outcome',
    '                for a guess. Do not inflate.',
    '  isSubscription - true when the descriptor identifies a recurring subscription',
    '                or membership billed on a schedule: streaming, software, a gym,',
    '                phone or internet service, insurance. Judge the merchant, not',
    '                the amount. "ANTHROPIC* CLAUDE SUB" and "GOOGLE *SPOTIFY MUSIC"',
    '                are true; a grocery run or a restaurant is false even if it',
    '                repeats. A one-off purchase from a company that also sells',
    '                subscriptions is false.',
    '',
    'Rules:',
    '- A payment to a credit card issuer, or a movement between the owner\'s own',
    '  accounts, is "Transfer" -- not a purchase.',
    '- Positive amounts on a depository account are usually income, refunds or',
    '  transfers, never spending.',
    '- Judge only from the descriptor. Do not infer facts about the account holder.',
    '',
    'Categories:',
    ...categoryNames.map((c) => `- ${c}`)
  ].join('\n');
}

export class ClaudeProvider implements CategorizationProvider {
  readonly name = 'claude';
  private client: Anthropic;

  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set (AI_PROVIDER=claude)');
    }
    this.client = new Anthropic();
  }

  async classify(items: ClassifyInput[], categoryNames: string[]): Promise<ClassifyResponse> {
    const usage: ClassifyUsage = {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: 0
    };
    const results: ClassifyResponse['results'] = [];
    const system = systemPrompt(categoryNames);

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const payload = batch
        .map((t) => `${t.index}\t${t.amount}\t${t.accountType}\t${t.description}`)
        .join('\n');

      const response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        // The taxonomy prefix is stable across calls. Caching only engages once
        // the prefix clears the model's minimum cacheable length, so treat any
        // hit as a bonus rather than something the cost model depends on.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content:
              'Categorize these transactions. Columns are: index, amount, account type, descriptor.\n\n' +
              payload
          }
        ],
        output_config: {
          // Classification does not reward deep reasoning; low effort keeps
          // both latency and the bill down.
          effort: 'low',
          format: zodOutputFormat(ResultSchema)
        }
      });

      usage.calls++;
      usage.inputTokens += response.usage.input_tokens ?? 0;
      usage.outputTokens += response.usage.output_tokens ?? 0;
      usage.cachedInputTokens += response.usage.cache_read_input_tokens ?? 0;

      const parsed = response.parsed_output;
      if (!parsed) {
        console.warn('[claude] batch returned unparseable output; sending it to review');
        for (const t of batch) {
          results.push({ index: t.index, merchant: t.description, category: null, confidence: 0, isSubscription: false });
        }
        continue;
      }

      const valid = new Set(categoryNames);
      const seen = new Set<number>();
      for (const r of parsed.results) {
        seen.add(r.index);
        results.push({
          index: r.index,
          merchant: r.merchant?.trim() || '',
          // A hallucinated category name is treated as no answer, not as truth.
          category: r.category && valid.has(r.category) ? r.category : null,
          confidence: Math.max(0, Math.min(1, r.confidence ?? 0)),
          isSubscription: !!r.isSubscription
        });
      }
      // A dropped row must not silently vanish from the ledger.
      for (const t of batch) {
        if (!seen.has(t.index)) {
          results.push({
            index: t.index,
            merchant: t.description,
            category: null,
            confidence: 0,
            isSubscription: false
          });
        }
      }
    }

    const price = PRICING[MODEL] ?? PRICING['claude-opus-5'];
    usage.costUsd =
      (usage.inputTokens / 1_000_000) * price.input +
      (usage.outputTokens / 1_000_000) * price.output;

    return { results, usage };
  }
}
