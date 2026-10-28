// Return values JSON cannot hold, or holds differently.
export function nanResult() {
  return 0 / 0;
}

export function negativeZero() {
  return -0;
}

export function bigTotal() {
  return 2n ** 64n;
}
