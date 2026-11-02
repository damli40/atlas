// R9: one-click sample files for a judge with no file at hand ("No file handy? Try one of these"). Each is a short, realistic file of the
// kind an AI assistant writes, with one behaviour worth betting on. They go through the normal paste flow: the same consent line, the same
// paid calls under the invite, nothing special-cased. Written for this hackathon. Atlas never says whether they are correct; a run shows
// what they do. No imports, so every one of them can run.

export interface SampleFile {
  id: string;
  /** The button's words. */
  label: string;
  language: "js" | "ts" | "py";
  code: string;
}

export const SAMPLE_FILES: readonly SampleFile[] = [
  {
    id: "fetch-retry",
    label: "Fetch with retry",
    language: "js",
    // Worth a bet: when every try fails, what comes back, and does it wait after the last try?
    code: `// Get JSON from an API, trying again a few times if the request does not go through.
export async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      // network hiccup: try again
    }
    // wait a little longer each time
    await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
  }
}
`,
  },
  {
    id: "price-parser",
    label: "Price parser",
    language: "py",
    // Worth a bet: what "19.99" becomes in cents.
    code: `# Read a small CSV of products and prices, and return each price in cents.
def parse_prices(csv_text):
    prices = {}
    lines = csv_text.strip().splitlines()
    for line in lines[1:]:  # skip the header row
        name, price = line.split(",")
        prices[name.strip()] = int(float(price) * 100)
    return prices


def total_cents(csv_text):
    return sum(parse_prices(csv_text).values())
`,
  },
  {
    id: "rate-cache",
    label: "Cached lookup",
    language: "ts",
    // Worth a bet: how many times the slow lookup runs when two calls arrive together.
    code: `// Look up an exchange rate, keeping each answer for a minute so the slow source is asked less often.
const cache = new Map<string, { value: number; at: number }>();

export async function getRate(currency: string, load: (c: string) => Promise<number>, maxAgeMs = 60_000): Promise<number> {
  const hit = cache.get(currency);
  if (hit && Date.now() - hit.at < maxAgeMs) {
    return hit.value;
  }
  const value = await load(currency);
  cache.set(currency, { value, at: Date.now() });
  return value;
}

export async function getTwoRates(load: (c: string) => Promise<number>) {
  return Promise.all([getRate("EUR", load), getRate("EUR", load)]);
}
`,
  },
];

const LANGUAGE_WORD = { js: "JavaScript", ts: "TypeScript", py: "Python" } as const;
const lineCount = (code: string) => (code.endsWith("\n") ? code.slice(0, -1) : code).split("\n").length;

export const SAMPLE_WORDS = {
  heading: "No file handy? Try one of these:",
  /** PLACEHOLDER for Dami's words. The fact it must keep, as the consent line does: a sample goes to a paid Meta model at once, like a paste. */
  consent: "A sample goes to Meta's AI as soon as Atlas draws it, like any file you paste.",
  /** Beside each button: its language and size, counted from the file itself. */
  about: (s: SampleFile) => `${LANGUAGE_WORD[s.language]}, ${lineCount(s.code)} lines`,
} as const;
