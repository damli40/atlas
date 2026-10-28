export async function retryWithinBudget(call: () => Promise<unknown>, budgetMs: number): Promise<unknown> {
  const started = Date.now();
  let wait = 50;
  for (;;) {
    try {
      return await call();
    } catch (err) {
      const left = budgetMs - (Date.now() - started);
      if (wait > left) {
        const e = new Error(`gave up after ${Date.now() - started} ms`);
        e.name = "BudgetExceeded";
        throw e;
      }
      await new Promise((r) => setTimeout(r, wait));
      wait *= 3;
    }
  }
}
