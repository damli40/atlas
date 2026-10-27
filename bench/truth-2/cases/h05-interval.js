// setInterval cleared from inside, with refresh().
export async function ticks(cb) {
  let n = 0;
  await new Promise((resolve) => {
    const h = setInterval(() => {
      n++;
      cb(n);
      if (n === 3) { clearInterval(h); resolve(); }
    }, 0);
  });
  return n;
}
export async function refreshed() {
  const t0 = Date.now();
  await new Promise((r) => {
    const h = setTimeout(r, 100);
    setTimeout(() => h.refresh(), 60);
  });
  return Date.now() - t0;
}
