// Quote an order: look up prices (cached), discount by quantity, add tax.
type PriceSource = (sku: string) => Promise<number>;

interface OrderLine {
  sku: string;
  qty: number;
}

interface CacheEntry {
  price: number;
  at: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function isFresh(entry: CacheEntry, now: number): boolean {
  return now - entry.at < TTL_MS;
}

async function lookupPrice(sku: string, source: PriceSource): Promise<number> {
  const hit = cache.get(sku);
  if (hit && isFresh(hit, Date.now())) {
    return hit.price;
  }
  const price = await source(sku);
  cache.set(sku, { price, at: Date.now() });
  return price;
}

function discountFor(qty: number): number {
  if (qty >= 100) return 0.15;
  if (qty >= 10) return 0.05;
  return 0;
}

function applyTax(subtotal: number, rate?: number): number {
  const r = rate ?? 0.2;
  return Math.round(subtotal * (1 + r));
}

export async function quoteOrder(
  lines: OrderLine[],
  source: PriceSource,
  taxRate?: number,
): Promise<number> {
  let subtotal = 0;
  for (const line of lines) {
    const price = await lookupPrice(line.sku, source);
    subtotal += price * line.qty * (1 - discountFor(line.qty));
  }
  return applyTax(subtotal, taxRate);
}

export function clearPrices(): void {
  cache.clear();
}
