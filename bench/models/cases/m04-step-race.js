export async function runStepsWithLimit(step, count) {
  let done = 0;
  const work = (async () => {
    for (let i = 0; i < count; i++) {
      await step(i);
      done++;
    }
    return done;
  })();
  const limit = new Promise((r) => setTimeout(() => r(`limit after ${done}`), 1000));
  return Promise.race([work, limit]);
}
