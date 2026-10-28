// Reads a price over the network.
export async function getPrice(symbol) {
  const res = await fetch("https://api.example.com/price/" + symbol);
  const body = await res.json();
  return body.price;
}

export async function getPriceOrOffline(symbol) {
  try {
    return await getPrice(symbol);
  } catch {
    return "offline";
  }
}
