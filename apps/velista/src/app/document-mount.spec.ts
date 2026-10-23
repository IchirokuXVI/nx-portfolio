import { documentMount } from './document-mount';

function docWithBase(href: string | null): Document {
  const doc = document.implementation.createHTMLDocument('velista');
  if (href !== null) {
    const base = doc.createElement('base');
    base.setAttribute('href', href);
    doc.head.appendChild(base);
  }
  return doc;
}

describe('documentMount', () => {
  it('reads the portfolio path from a /velista/ base', () => {
    expect(documentMount(docWithBase('/velista/'))).toBe('/velista');
  });

  it('is empty for the own origin base', () => {
    expect(documentMount(docWithBase('/'))).toBe('');
  });

  it('is empty when the document has no base element', () => {
    expect(documentMount(docWithBase(null))).toBe('');
  });
});
