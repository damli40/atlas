// A trailing-edge debounce: only the last call in a burst runs, waitMs after the burst ends.
function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function typeThenWait(onSearch) {
  const search = debounce(onSearch, 200);
  search("a");
  await sleep(50);
  search("ab");
  await sleep(50);
  search("abc");
  await sleep(500);
  return "done";
}

export function fireAndReturn(onSearch) {
  const search = debounce(onSearch, 200);
  search("x");
  return "queued";
}
