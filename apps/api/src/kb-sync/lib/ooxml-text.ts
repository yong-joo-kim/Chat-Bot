import { Parser } from 'htmlparser2';
import { safeUnzipEntries } from './container-guard';
import type { ContainerGuardLimits } from './container-guard';

/**
 * [신규 No.43] OOXML(DOCX·XLSX·PPTX) 텍스트 추출(순수 — §7.1). `fflate`로 안전 해제한 뒤 자체 XML
 * 텍스트 추출(스크립트 실행 0 · DOCTYPE/엔티티 발견 시 그 파트를 버린다).
 */
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export function isOle2Signature(bytes: Uint8Array): boolean {
  if (bytes.length < OLE2_SIGNATURE.length) return false;
  for (let i = 0; i < OLE2_SIGNATURE.length; i += 1) if (bytes[i] !== OLE2_SIGNATURE[i]) return false;
  return true;
}

function extractTextFromXmlPart(xml: string): string {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) return '';
  let out = '';
  const parser = new Parser({ ontext: (t) => (out += `${t} `) }, { xmlMode: true });
  parser.write(xml);
  parser.end();
  return out;
}

export interface OoxmlExtractResult {
  text: string;
  hasMacro: boolean;
}

export function extractOoxmlText(kind: 'DOCX' | 'XLSX' | 'PPTX', bytes: Uint8Array, limits?: ContainerGuardLimits): OoxmlExtractResult {
  const entries = safeUnzipEntries(bytes, limits);
  const hasMacro = [...entries.keys()].some((k) => k.toLowerCase().endsWith('vbaproject.bin'));
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const parts: string[] = [];

  if (kind === 'DOCX') {
    const doc = entries.get('word/document.xml');
    if (doc) parts.push(extractTextFromXmlPart(decoder.decode(doc)));
  } else if (kind === 'PPTX') {
    const slideNames = [...entries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
    for (const name of slideNames) {
      const bytes2 = entries.get(name);
      if (bytes2) parts.push(extractTextFromXmlPart(decoder.decode(bytes2)));
    }
  } else {
    const shared = entries.get('xl/sharedStrings.xml');
    if (shared) parts.push(extractTextFromXmlPart(decoder.decode(shared)));
    const sheetNames = [...entries.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
    for (const name of sheetNames) {
      const bytes2 = entries.get(name);
      if (bytes2) parts.push(extractTextFromXmlPart(decoder.decode(bytes2)));
    }
  }

  const text = parts
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, hasMacro };
}
