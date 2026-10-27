function throttle(fn, ms) {
  let last = -Infinity;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}

export async function clicks(onClick, gapMs, times) {
  const handler = throttle(onClick, 250);
  for (let i = 0; i < times; i++) {
    handler(i);
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return "clicked";
}
