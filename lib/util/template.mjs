/**
 * Fills {{name}} placeholders in a template file's text, keeping its line
 * endings. `escape` prepares each value for the file's format, except the
 * names listed in `raw`, which are inserted as written. A name with no value
 * is an error, so no placeholder is ever left behind.
 */
export function fillTemplate(text, values, { escape = (value) => value, raw = [] } = {}) {
  const missing = new Set();
  const out = String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name) => {
    if (!Object.hasOwn(values, name) || values[name] === undefined || values[name] === null) {
      missing.add(name);
      return whole;
    }
    return raw.includes(name) ? String(values[name]) : escape(String(values[name]));
  });
  if (missing.size > 0) throw new Error(`The template needs values it was not given: ${[...missing].join(', ')}.`);
  return out;
}

/** Escapes text for an XML element or attribute value. */
export function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
