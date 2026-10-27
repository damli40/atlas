export async function timedSession(login, logout) {
  const t0 = Date.now();
  const user = await login();
  const t1 = Date.now();
  await new Promise((r) => setTimeout(r, 250));
  await logout(user);
  return { user, loginMs: t1 - t0, totalMs: Date.now() - t0 };
}
