// Runs text as code.
export function calc(expr) {
  return eval(expr);
}

export function makeAdder(n) {
  return new Function("x", "return x + " + n)(1);
}
