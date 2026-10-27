function breaker(call, { failuresToOpen, coolDownMs }) {
  let failures = 0;
  let openedAt = null;
  return async (...args) => {
    if (openedAt !== null) {
      if (Date.now() - openedAt < coolDownMs) throw new Error("open");
      openedAt = null;
    }
    try {
      const v = await call(...args);
      failures = 0;
      return v;
    } catch (e) {
      failures++;
      if (failures >= failuresToOpen) openedAt = Date.now();
      throw e;
    }
  };
}

export async function fiveTries(call, spacingMs) {
  const guarded = breaker(call, { failuresToOpen: 2, coolDownMs: 1000 });
  const seen = [];
  for (let i = 0; i < 5; i++) {
    try {
      seen.push(await guarded(i));
    } catch (e) {
      seen.push(`x:${e.message}`);
    }
    await new Promise((r) => setTimeout(r, spacingMs));
  }
  return seen;
}
