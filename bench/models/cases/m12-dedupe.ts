export function dedupeBy(items: Array<Record<string, unknown>>, key: string): Array<Record<string, unknown>> {
  const seen = new Map<unknown, Record<string, unknown>>();
  for (const item of items) seen.set(item[key], item);
  return [...seen.values()];
}
