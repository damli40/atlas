// Three different "lengths" of the same text.
export function lengths(s: string): { utf16: number; codePoints: number; bytes: number } {
  return { utf16: s.length, codePoints: [...s].length, bytes: new TextEncoder().encode(s).length };
}
