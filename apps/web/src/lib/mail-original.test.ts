import { describe, expect, test } from 'vitest';
import { attachmentSize, attachmentUrl, hasRemoteImages, mailDocument, mailDocumentCsp, sanitizeMailHtml } from './mail-original';

describe('sanitizeMailHtml (the third layer)', () => {
  test('drops what runs or loads another document', () => {
    const out = sanitizeMailHtml(
      '<p>Hola</p><script>alert(1)</script><SCRIPT src="//x"></SCRIPT><iframe src="https://x"></iframe><object data="x"></object><embed src="x">',
    );
    expect(out).toBe('<p>Hola</p>');
  });

  test('drops meta refresh, base and stylesheets from outside', () => {
    const out = sanitizeMailHtml(
      '<meta http-equiv="refresh" content="0;url=https://evil"><base href="https://evil/"><link rel="stylesheet" href="https://t/x.css"><p>ok</p>',
    );
    expect(out).toBe('<p>ok</p>');
  });

  test('drops event handlers, quoted or not', () => {
    const out = sanitizeMailHtml('<img src="data:," onerror="alert(1)"><p onclick=alert(1) class="a">x</p><a OnMouseOver=\'x()\'>y</a>');
    expect(out).not.toMatch(/on(error|click|mouseover)/i);
    expect(out).toContain('class="a"');
  });

  test('neutralises javascript: and data:text/html links', () => {
    const out = sanitizeMailHtml(
      '<a href="javascript:alert(1)">a</a><a href=\'  JavaScript:x\'>b</a><a href=javascript:y>c</a><a href="data:text/html,<b>">d</a><a href="https://ok.example">e</a>',
    );
    expect(out).not.toMatch(/javascript|data:text\/html/i);
    expect(out).toContain('href="https://ok.example"');
    expect(out.match(/href="#"/g)).toHaveLength(4);
  });

  test('keeps the mail itself: styles, tables, quotes', () => {
    const html = '<style>p{color:red}</style><table><tr><td>1</td></tr></table><blockquote>dijo</blockquote>';
    expect(sanitizeMailHtml(html)).toBe(html);
  });
});

describe('mailDocument', () => {
  test('blocks everything from outside by default, the CSP first in head', () => {
    const doc = mailDocument('<p>x</p>');
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<p>x</p>'));
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('img-src data:;');
    expect(doc).not.toContain('https:');
    expect(doc).toContain('<base target="_blank">');
    expect(doc).toContain('name="referrer" content="no-referrer"');
  });

  test('images from outside only when asked', () => {
    expect(mailDocumentCsp(true)).toContain('img-src data: https: http:');
    expect(mailDocumentCsp(false)).not.toMatch(/https?:/);
    expect(mailDocument('<p>x</p>', { images: true })).toContain('img-src data: https: http:');
  });

  test('sanitises what it wraps', () => {
    expect(mailDocument('<script>x</script><p>y</p>')).not.toContain('<script>');
  });
});

describe('hasRemoteImages', () => {
  test('sees img, CSS url() and background from outside', () => {
    expect(hasRemoteImages('<img src="https://t.example/p.gif">')).toBe(true);
    expect(hasRemoteImages("<img alt=x src='//t.example/p.gif'>")).toBe(true);
    expect(hasRemoteImages('<td style="background:url(https://x/y.png)">')).toBe(true);
    expect(hasRemoteImages('<td background="http://x/y.png">')).toBe(true);
    expect(hasRemoteImages('<img src="cid:logo@x"><img src="data:image/png;base64,AA">')).toBe(false);
  });
});

describe('urls and sizes', () => {
  test('attachment url escapes the part id', () => {
    expect(attachmentUrl('c', 'e', '0.1')).toBe('/api/conversations/c/events/e/original/attachments/0.1');
    expect(attachmentUrl('c', 'e', '../x')).toBe('/api/conversations/c/events/e/original/attachments/..%2Fx');
  });
  test('sizes', () => {
    expect(attachmentSize(512, 'es')).toBe('512 B');
    expect(attachmentSize(48213, 'es')).toBe('47 KB');
    expect(attachmentSize(1.5 * 1024 * 1024, 'es')).toBe('1,5 MB');
  });
});
