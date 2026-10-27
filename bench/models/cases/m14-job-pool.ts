export async function runPool(job: (id: number) => Promise<unknown>, ids: number[], limit: number): Promise<number[]> {
  const finished: number[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < ids.length) {
      const id = ids[next++]!;
      await job(id);
      finished.push(id);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return finished;
}
