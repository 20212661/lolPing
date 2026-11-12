/**
 * Parses what a PopClip import pastes: a Config.json object, or the small YAML subset PopClip's own
 * Config.yaml and snippets use — top-level `key: value` pairs and an `actions:` list of flat entries.
 * No dependency: anchors, multi-line strings and nesting are out of scope, and a config using them
 * fails as unparseable rather than loading wrongly.
 */

type Obj = Record<string, unknown>;

const stripQuotes = (v: string): string => {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))) {
    return t.slice(1, -1);
  }
  return t;
};

/** Splits "key: value" at the first colon outside quotes; null when there is no colon. */
function splitEntry(line: string): [string, string] | null {
  const inSingle = line.includes("'") && line.indexOf("'") < line.indexOf(':');
  const colon = inSingle ? line.indexOf(':', line.indexOf("'", line.indexOf("'") + 1)) : line.indexOf(':');
  if (colon <= 0) return null;
  return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
}

/** Parses the PopClip YAML subset; null when the text needs anything richer. */
function parseYamlSubset(text: string): Obj | null {
  const lines = text.split(/\r?\n/).map((l) => {
    const t = l.trim();
    return t.startsWith('#') ? '' : t; // whole-line comments only; a '#' inside a value is data
  });
  const root: Obj = {};
  const actions: Obj[] = [];
  let current: Obj | null = null; // the actions entry being filled, null at the top level
  for (const line of lines) {
    if (line === '') continue;
    if (line.startsWith('- ')) {
      const entry = splitEntry(line.slice(2));
      if (!entry) return null;
      current = {};
      actions.push(current);
      const [k, v] = entry;
      current[k] = stripQuotes(v);
      continue;
    }
    const entry = splitEntry(line);
    if (!entry) return null;
    const [k, v] = entry;
    if (v === '') {
      if (k === 'actions') current = {}; // the list opens; entries follow as "- …"
      else return null; // a nested block PopClip configs do not use
      continue;
    }
    if (current !== null) current[k] = stripQuotes(v);
    else root[k] = stripQuotes(v);
  }
  if (actions.length > 0) root.actions = actions;
  return root;
}

/** A PopClip config as an object, from pasted JSON or PopClip-style YAML; null when neither parses. */
export function parsePopClipText(text: string): Obj | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const v = JSON.parse(trimmed) as unknown;
      return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null;
    } catch {
      return null;
    }
  }
  return parseYamlSubset(trimmed);
}
