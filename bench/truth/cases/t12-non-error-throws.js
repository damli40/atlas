// Things thrown that are not Error objects.
export function throwString(code) {
  throw `failed with ${code}`;
}

export function throwObject() {
  throw { code: 42, retry: false };
}

export async function rejectNull() {
  await Promise.resolve();
  throw null;
}
