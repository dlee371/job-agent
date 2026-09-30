// Small text helpers shared by sources, the filter and (later) the fact-check.

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  bull: "•",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Turns job-description HTML into readable plain text for Claude and the filter.
 * Greenhouse double-encodes its HTML (&lt;p&gt;), so entities are decoded before AND
 * after stripping tags.
 */
export function htmlToText(html: string): string {
  const decoded = decodeEntities(html);
  const text = decoded
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n+- /g, "\n- ") // no blank lines between list items
    .trim();
}

/** Lowercase, unify common spellings, drop punctuation, collapse spaces. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/full[\s-]?stack/g, "fullstack")
    .replace(/front[\s-]?end/g, "frontend")
    .replace(/back[\s-]?end/g, "backend")
    .replace(/[^a-z0-9+#]+/g, " ") // keep + and # for C++ / C#
    .trim();
}

export function words(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(" ") : [];
}
