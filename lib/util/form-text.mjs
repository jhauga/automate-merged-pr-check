/** Text with Windows line endings and trailing spaces removed. */
export function normalizeText(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '\n');
}

/** Every line with its HTML comments removed; the hints in a form are comments. */
export function withoutComments(lines) {
  const out = [];
  let inside = false;
  for (const line of lines) {
    let text = line;
    let clean = '';
    for (;;) {
      if (inside) {
        const end = text.indexOf('-->');
        if (end === -1) {
          text = '';
          break;
        }
        inside = false;
        text = text.slice(end + 3);
        continue;
      }
      const start = text.indexOf('<!--');
      if (start === -1) {
        clean += text;
        break;
      }
      clean += text.slice(0, start);
      text = text.slice(start + 4);
      inside = true;
    }
    out.push(clean);
  }
  return out;
}
