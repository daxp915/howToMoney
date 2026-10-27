/**
 * A merchant name for display: "Amazon Mktpl 2k4lp" -> "Amazon".
 *
 * Card processors pad the merchant with a reference code and a marketplace
 * tag. Only trailing words go, and only ones that are plainly not part of a
 * name: anything carrying a digit, a leading # or *, or one of a short list of
 * processor words. "Interest Payment" and "7-Eleven" are left alone -- a
 * trailing word is removed only while at least one word remains, and "Payment"
 * is a real word in real names, so it is not on the list.
 *
 * Display only. The stored name, and the merchant key every categorization
 * layer joins on, are untouched.
 */
const NOISE = new Set(['mktpl', 'mktp', 'marketplace', 'pos', 'purchase', 'debit']);

export function cleanMerchant(name: string): string {
  const words = name.trim().split(/\s+/);
  while (words.length > 1) {
    const w = words[words.length - 1];
    const bare = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/\d/.test(w) || /^[#*]/.test(w) || NOISE.has(bare)) {
      words.pop();
      continue;
    }
    break;
  }
  return words.join(' ');
}
