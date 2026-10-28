// A tiny least-recently-used cache built on Map's insertion order.
class Lru<V> {
  readonly max: number;
  map: Map<string, V> = new Map();

  constructor(max: number) {
    this.max = max;
  }

  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }

  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}

export function lruAfterTouch(): { keys: string[]; b: number | null } {
  const cache = new Lru<number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");
  cache.set("c", 3);
  return { keys: [...cache.map.keys()], b: cache.get("b") ?? null };
}

export function lruInstance(): Lru<number> {
  const cache = new Lru<number>(2);
  cache.set("a", 1);
  return cache;
}
