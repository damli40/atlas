// Loads several ids at once. allSettled keeps every result; all stops at the first failure.
export async function loadAllSettled(load, ids) {
  const results = await Promise.allSettled(ids.map((id) => load(id)));
  return results.map((r) => (r.status === "fulfilled" ? r.value : `error: ${r.reason.message}`));
}

export async function loadAll(load, ids) {
  return await Promise.all(ids.map((id) => load(id)));
}
