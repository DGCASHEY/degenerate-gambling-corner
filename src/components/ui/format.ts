// Display-only formatting. These never round a value that gets stored or
// settled; they only decide how a number the server sent is shown.
// parseCoins reads what a player typed; the server checks it again.

const coins = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCoins(amount: number): string {
  return coins.format(amount);
}

// Always shows the sign, so a loss can never be mistaken for a win.
export function formatSignedCoins(amount: number): string {
  if (amount > 0) return `+${coins.format(amount)}`;
  if (amount < 0) return `−${coins.format(-amount)}`;
  return coins.format(0);
}

export function formatMultiplier(multiplier: number): string {
  return `${multiplier.toFixed(2)}×`;
}

// Hundredths of a coin (the ledger's unit), shown as coins.
export function formatUnits(units: number): string {
  return coins.format(units / 100);
}

export function formatSignedUnits(units: number): string {
  return formatSignedCoins(units / 100);
}

// "12.5" -> 1250 hundredths. null for anything that isn't a plain amount
// with at most two decimal places. Worked out from the digits, so no
// floating-point rounding.
export function parseCoins(typed: string): number | null {
  const match = /^\s*(\d{1,12})(?:\.(\d{0,2}))?\s*$/.exec(typed.replace(/,/g, ""));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}
