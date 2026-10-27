import chunk from "lodash/chunk.js";

// Splits a list into pairs with a library.
export function pairs(list) {
  return chunk(list, 2);
}
