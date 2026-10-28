// Starts a save and does not wait for it or handle its failure.
export function fireAndForget(save) {
  save("draft");
  return "sent";
}
