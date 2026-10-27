// Hashing with Web Crypto: work that finishes in the background, outside any timer.
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashOrTimeout(text) {
  const timeout = new Promise((r) => setTimeout(() => r("timeout"), 10));
  return Promise.race([sha256Hex(text), timeout]);
}
