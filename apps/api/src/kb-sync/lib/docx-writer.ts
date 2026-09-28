import { zipSync } from 'fflate';

/**
 * [신규 No.43] 최소 OOXML(DOCX) 생성기(순수 — §5.5). `fflate.zipSync` + 자체 최소 4파트
 * (`[Content_Types].xml`·`_rels/.rels`·`word/document.xml`·`word/styles.xml`). 고정 mtime(같은
 * 텍스트 = 같은 바이트 — 결정적). 제목 `Heading1`~`Heading3` 스타일 · 목록은 "• " 문단 그대로 ·
 * XML 금지 제어 문자 제거·이스케이프.
 */
// ZIP(DOS) 날짜 형식은 1980년 이전을 표현할 수 없다 — 결정적이면서 유효한 최솟값을 고정값으로 쓴다.
const FIXED_MTIME = new Date('1980-01-01T00:00:00Z');

function escapeXml(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`;

function paragraphXml(line: string): string {
  let style: string | null = null;
  let text = line;
  if (text.startsWith('### ')) {
    style = 'Heading3';
    text = text.slice(4);
  } else if (text.startsWith('## ')) {
    style = 'Heading2';
    text = text.slice(3);
  } else if (text.startsWith('# ')) {
    style = 'Heading1';
    text = text.slice(2);
  }
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

export interface DocxSourceDoc {
  headerLines: readonly string[];
  bodyText: string;
}

export function buildDocx(doc: DocxSourceDoc): Uint8Array {
  const lines = [...doc.headerLines, '', ...doc.bodyText.split('\n')];
  const bodyXml = lines.map((l) => paragraphXml(l)).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}<w:sectPr/></w:body></w:document>`;

  const enc = new TextEncoder();
  return zipSync(
    {
      '[Content_Types].xml': [enc.encode(CONTENT_TYPES), { mtime: FIXED_MTIME }],
      '_rels/.rels': [enc.encode(RELS), { mtime: FIXED_MTIME }],
      'word/document.xml': [enc.encode(documentXml), { mtime: FIXED_MTIME }],
      'word/styles.xml': [enc.encode(STYLES), { mtime: FIXED_MTIME }],
    },
    { level: 6, mtime: FIXED_MTIME },
  );
}
