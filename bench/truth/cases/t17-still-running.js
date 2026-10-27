// Work that never stops: a heartbeat on a timer, and a loop that never yields.
export async function heartbeat(ping) {
  for (;;) {
    await ping();
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export function spinForever() {
  let n = 0;
  for (;;) n++;
}
