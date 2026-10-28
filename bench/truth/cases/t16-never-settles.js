// Waiting for something that never comes.
export async function waitForEvent(subscribe) {
  return await new Promise((resolve) => {
    subscribe(resolve);
  });
}

export async function loadOnce(load) {
  const v = await load();
  return v;
}
