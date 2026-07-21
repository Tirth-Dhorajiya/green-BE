const allowedTags = new Set([
  'p', 'br', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'ul', 'ol', 'li', 'blockquote', 'hr', 'code', 'pre', 'a',
]);

const voidTags = new Set(['br', 'hr']);

const escapeAttribute = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const getAttribute = (attrs, name) => {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const match = attrs.match(pattern);
  return match ? (match[2] || match[3] || match[4] || '') : '';
};

const isSafeHref = (href) => /^(https?:|mailto:)/i.test(String(href).trim());

const sanitizeProductDescription = (value) => {
  if (value === undefined || value === null) return value;

  return String(value)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(\/?)\s*([a-zA-Z][\w:-]*)([^>]*)>/g, (_match, closing, rawTagName, attrs) => {
      const tagName = String(rawTagName).toLowerCase();
      if (!allowedTags.has(tagName)) return '';
      if (closing) return voidTags.has(tagName) ? '' : `</${tagName}>`;
      if (tagName === 'a') {
        const href = getAttribute(attrs || '', 'href').trim();
        const safeHref = isSafeHref(href) ? ` href="${escapeAttribute(href)}"` : '';
        return `<a${safeHref} target="_blank" rel="noopener noreferrer">`;
      }
      return `<${tagName}>`;
    })
    .trim();
};

module.exports = { sanitizeProductDescription };
