// Display-only formatting. These never round a value that gets stored or
// settled; they only decide how a number the server sent is shown.

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
