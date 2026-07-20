const sanitizeHtml = require('sanitize-html');

const sanitizeProductDescription = (value) => {
  if (value === undefined || value === null) return value;

  return sanitizeHtml(String(value), {
    allowedTags: [
      'p', 'br', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
      'ul', 'ol', 'li', 'blockquote', 'hr', 'code', 'pre', 'a',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          ...attribs,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    },
  }).trim();
};

module.exports = { sanitizeProductDescription };
