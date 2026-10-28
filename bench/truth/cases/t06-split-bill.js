// Splits a bill in whole cents; the leftover cents go to the first people, one each.
export function splitBill(totalCents, people) {
  if (!Number.isInteger(totalCents) || !Number.isInteger(people) || people <= 0) {
    throw new TypeError("whole cents and a positive head count");
  }
  const base = Math.floor(totalCents / people);
  let rest = totalCents - base * people;
  const shares = [];
  for (let i = 0; i < people; i++) {
    shares.push(base + (rest > 0 ? 1 : 0));
    if (rest > 0) rest--;
  }
  return shares;
}
