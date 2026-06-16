'use strict';

/*
 * Shared YAML-frontmatter reader for the ESCC CI validators.
 *
 * Deliberately a thin top-level-key extractor, not a full YAML parser: the
 * validators only need the leading scalar keys (name, description, model,
 * origin, argument-hint, tools) plus duplicate-key detection. Nested/indented
 * lines are skipped — they belong to a parent mapping or sequence. Tolerant of
 * a UTF-8 BOM and CRLF line endings, matching the content authored across the
 * skills/agents/commands trees.
 */

/**
 * Parse the leading `--- ... ---` frontmatter block of a markdown document.
 *
 * Block scalars are resolved: `description: >-` (folded) or `: |` (literal)
 * followed by indented lines yields the joined body as the value, so a
 * presence/non-empty check on `values.description` is meaningful rather than
 * matching the bare `">-"` indicator. The indicator char is recorded in
 * `indicators` so a caller can reject a literal `|` (which preserves newlines
 * and breaks flat-table renderers keyed off `description`).
 *
 * @param {string} content raw file contents
 * @returns {{present: boolean, raw: string, body: string,
 *            values: Object<string,string>, indicators: Object<string,string>,
 *            duplicates: string[]}}
 *   `present` is false when no frontmatter block is found (body is the whole
 *   document). `values` holds trimmed top-level scalar values keyed by name
 *   (block scalars resolved); `indicators` maps a key to '>' or '|' when its
 *   value is a block scalar; `duplicates` lists any repeated top-level key.
 */
function parseFrontmatter(content) {
  let clean = String(content);
  if (clean.charCodeAt(0) === 0xFEFF) clean = clean.slice(1); // strip a leading UTF-8 BOM
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return {
      present: false, raw: '', body: clean,
      values: Object.create(null), indicators: Object.create(null), duplicates: [],
    };
  }

  const raw = match[1];
  const body = clean.slice(match[0].length);
  const values = Object.create(null);
  const indicators = Object.create(null);
  const duplicates = [];
  const lines = raw.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const idx = line.indexOf(':');
    if (/^\s/.test(line) || idx <= 0) { i += 1; continue; } // indented body / non-key line

    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    if (Object.prototype.hasOwnProperty.call(values, key)) duplicates.push(key);

    // Detect a block-scalar header (`>`, `|`, with optional chomp/indent and comment).
    const blockHeader = rawValue.replace(/\s+#.*$/, '').trim().match(/^([|>])(?:[+-]?\d+|\d+[+-]?|[+-])?$/);
    if (blockHeader) {
      indicators[key] = blockHeader[1];
      const collected = [];
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || /^\s/.test(lines[j]))) {
        collected.push(lines[j].replace(/^\s+/, ''));
        j += 1;
      }
      while (collected.length && collected[collected.length - 1] === '') collected.pop();
      values[key] = collected.join(blockHeader[1] === '>' ? ' ' : '\n').trim();
      i = j;
      continue;
    }

    values[key] = rawValue;
    i += 1;
  }

  return { present: true, raw, body, values, indicators, duplicates };
}

module.exports = { parseFrontmatter };
