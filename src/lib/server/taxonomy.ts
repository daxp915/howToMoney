// The taxonomy is sent to the model on every classification call, so keep it
// short and unambiguous. Overlapping categories ("Shopping" vs "Retail") are
// what produce low-confidence answers and a noisy review queue.
//
// Colors are identity swatches shown beside the name, not a chart encoding --
// charts render magnitude in a single hue and carry identity in the label, so
// this list is free to exceed the eight slots any colorblind-safe categorical
// palette tops out at. The user can change every one of them.
//
// Every value below is a step of the design system's own ramps, because these
// swatches are the app's largest area of colour: they fill the flow diagram's
// ribbons and every row of the category list. Left as the rainbow they used to
// be -- blues, purples, magentas -- they made a cream-and-terracotta page look
// like two products stitched together, and no amount of token work could fix
// it, because the colours live in the database rather than the stylesheet.
//
// Spending walks the terracotta ramp (800 #643312 … 200 #ffe1d0), repeating a
// step only where the two categories sit far apart in the list so neighbouring
// rows always differ. Administrative categories nobody thinks of as spending --
// insurance, tax, fees, cash -- take the neutral sand ramp and recede. Sage is
// reserved for income: in the data palette it means money arriving, and a sage
// expense swatch would contradict the diagram directly above it.
//
// Changing a value here only affects new installs.
export const TAXONOMY: Array<{ name: string; group: string; color: string; icon?: string }> = [
  { name: 'Salary', group: 'income', color: '#56633f', icon: '💼' },
  { name: 'Other Income', group: 'income', color: '#728157', icon: '💵' },
  { name: 'Refund', group: 'income', color: '#8fa073', icon: '↩️' },
  { name: 'Transfer', group: 'transfer', color: '#82796a', icon: '🔁' },

  { name: 'Groceries', group: 'expense', color: '#8c491a', icon: '🛒' },
  { name: 'Restaurants', group: 'expense', color: '#d67f48', icon: '🍽️' },
  { name: 'Coffee', group: 'expense', color: '#ffc6a5', icon: '☕' },
  { name: 'Rent & Mortgage', group: 'expense', color: '#643312', icon: '🏠' },
  { name: 'Utilities', group: 'expense', color: '#b2622d', icon: '💡' },
  { name: 'Internet & Phone', group: 'expense', color: '#f6a06b', icon: '📶' },
  { name: 'Insurance', group: 'expense', color: '#a19786', icon: '🛡️' },
  { name: 'Transportation', group: 'expense', color: '#8c491a', icon: '🚗' },
  { name: 'Gas & Fuel', group: 'expense', color: '#d67f48', icon: '⛽' },
  { name: 'Travel', group: 'expense', color: '#f6a06b', icon: '✈️' },
  { name: 'Shopping', group: 'expense', color: '#b2622d', icon: '🛍️' },
  { name: 'Subscriptions', group: 'expense', color: '#ffc6a5', icon: '🔄' },
  { name: 'Entertainment', group: 'expense', color: '#d67f48', icon: '🎬' },
  { name: 'Health & Medical', group: 'expense', color: '#8c491a', icon: '🏥' },
  { name: 'Fitness', group: 'expense', color: '#b2622d', icon: '🏋️' },
  { name: 'Personal Care', group: 'expense', color: '#f6a06b', icon: '💈' },
  { name: 'Home & Garden', group: 'expense', color: '#ffc6a5', icon: '🔧' },
  { name: 'Pets', group: 'expense', color: '#b2622d', icon: '🐾' },
  { name: 'Gifts & Donations', group: 'expense', color: '#ffc6a5', icon: '🎁' },
  { name: 'Education', group: 'expense', color: '#f6a06b', icon: '📚' },
  { name: 'Taxes', group: 'expense', color: '#645c50', icon: '🧾' },
  { name: 'Fees & Interest', group: 'expense', color: '#643312', icon: '🏦' },
  { name: 'Cash & ATM', group: 'expense', color: '#82796a', icon: '🏧' },
  { name: 'Uncategorized', group: 'expense', color: '#c0b6a5', icon: '❓' }
];
