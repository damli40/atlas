// Final review S7: how a dollar cost is shown on screen.
//
// Plain words: Atlas logs what each model call cost, from token counts and a price per million tokens. Two
// prices are published (Muse Wonder: Meta's hackathon materials; Muse Spark Open: Baseten's model page). Muse
// Spark's price is not published, so Atlas assumes Wonder's price for it: the logged figure is then an upper
// bound, not a bill. A cost at an unconfirmed price is shown as "≤ $X (upper bound: price not confirmed)".
// server/meta/client.ts reads the same list, so the screen and the usage log agree on which prices are known.

import { SPARK_OPEN_MODEL } from "./claimants";

/** Model ids whose price per token is published and checked (see server/meta/client.ts for the sources). */
export const PRICE_CONFIRMED_MODELS: readonly string[] = ["muse-wonder-1.0", SPARK_OPEN_MODEL];

export const priceConfirmed = (model: string) => PRICE_CONFIRMED_MODELS.includes(model.trim());

/** "$0.1234" when every model in the figure has a confirmed price, else "≤ $0.1234 (upper bound: price not confirmed)". */
export function costText(usd: number, confirmed: boolean): string {
  const x = `$${usd.toFixed(4)}`;
  return confirmed ? x : `≤ ${x} (upper bound: price not confirmed)`;
}
