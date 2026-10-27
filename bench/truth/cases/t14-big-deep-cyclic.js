// Returned values that are too big, too deep, or contain themselves.
export function bigList(n) {
  return Array.from({ length: n }, (_, i) => i);
}

export function nested(depth) {
  let v = "leaf";
  for (let i = 0; i < depth; i++) v = { v };
  return v;
}

export function selfRef() {
  const o = { name: "loop" };
  o.self = o;
  return o;
}
