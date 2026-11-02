type Page<T> = { items: T[]; nextCursor: string | null };

async function fetchPage<T>(url: string, cursor: string | null, attempt = 0): Promise<Page<T>> {
  const res = await fetch(cursor ? `${url}?cursor=${cursor}` : url);
  if (res.status === 429 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    return fetchPage<T>(url, cursor, attempt + 1);
  }
  if (!res.ok) throw new Error("HTTP 429");
  return (await res.json()) as Page<T>;
}

export async function fetchAllOrders(url: string, maxPages = 5): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data: Page<{ id: string }> = await fetchPage(url, cursor);
    for (const o of data.items) ids.push(o.id);
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
  }
  return ids;
}
