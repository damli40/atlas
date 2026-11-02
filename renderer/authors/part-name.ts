// R6: a function's name in plain words, for the machine's lids and the part's panel. "fetchWithRetry" reads "fetch with retry". Plain code
// splits the name it was given by its own capitals, underscores and digits. Nothing comes from a model, and nothing is added. Pure.

/** The words in a name, or null when splitting adds nothing (one word) or can't be done cleanly (a letter the split doesn't know). */
export function nameWords(name: string): string | null {
  const bare = name.replace(/^[_$]+|[_$]+$/g, "");
  const words = bare.split(/[_$]+/).flatMap((chunk) => chunk.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g) ?? []);
  // Every letter of the name must be in the words: a name the split would lose part of keeps its exact form only.
  if (words.join("") !== bare.replace(/[_$]+/g, "")) return null;
  if (words.length < 2) return null;
  // A run of capitals is an acronym and keeps them ("URL"). Anything else reads in small letters.
  return words.map((w) => (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w) ? w : w.toLowerCase())).join(" ");
}

/** A word for a function with no name of its own, from syntax alone. Only the one case the machine draws: a JavaScript default export. */
export function roleOf(name: string, language: "js" | "ts" | "py"): string | null {
  // "default" can't be a function's own name in JavaScript, so a part called that is the file's unnamed default export. In Python it is a real name.
  return language !== "py" && name === "default" ? "the default export" : null;
}
