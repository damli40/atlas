// A TypeScript enum: needs code generation, not just type removal.
export enum Level {
  Low = 1,
  High = 2,
}

export function levelName(n: number): string {
  return Level[n] ?? "unknown";
}
