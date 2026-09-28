import { detectKind, isFileUrl } from './detect-kind';

describe('detectKind (pass 9 · L-7)', () => {
  describe('확장자 — 문서 파일', () => {
    it.each([
      ['https://a.example/docs/manual.pdf', 'PDF'],
      ['https://a.example/docs/manual.docx', 'DOCX'],
      ['https://a.example/docs/table.xlsx', 'XLSX'],
      ['https://a.example/docs/slide.pptx', 'PPTX'],
    ])('%s → %s', (url, kind) => {
      expect(detectKind(url, undefined, [])).toBe(kind);
    });
  });

  describe('대소문자 — 확장자는 대소문자를 가리지 않는다', () => {
    it.each([
      ['https://a.example/docs/MANUAL.PDF', 'PDF'],
      ['https://a.example/docs/Manual.Docx', 'DOCX'],
      ['https://a.example/docs/TABLE.XLSX', 'XLSX'],
      ['https://a.example/docs/Slide.PptX', 'PPTX'],
    ])('%s → %s', (url, kind) => {
      expect(detectKind(url, undefined, [])).toBe(kind);
    });
    it('비대상 확장자도 대문자로 판정한다', () => {
      expect(detectKind('https://a.example/img/LOGO.PNG', undefined, [])).toBeNull();
    });
  });

  describe('쿼리·해시 — 경로만 본다', () => {
    it('쿼리에 .pdf가 있어도 경로 확장자가 아니면 HTML이다', () => {
      expect(detectKind('https://a.example/download?file=manual.pdf', undefined, [])).toBe('HTML');
    });
    it('경로가 .pdf로 끝나면 쿼리가 있어도 PDF다', () => {
      expect(detectKind('https://a.example/docs/manual.pdf?version=2', undefined, [])).toBe('PDF');
    });
    it('경로가 .png로 끝나면 쿼리가 있어도 비대상이다', () => {
      expect(detectKind('https://a.example/img/a.png?w=200', undefined, [])).toBeNull();
    });
    it('해시(프래그먼트)는 경로가 아니다', () => {
      expect(detectKind('https://a.example/docs/manual.pdf#page=3', undefined, [])).toBe('PDF');
      expect(detectKind('https://a.example/docs/guide#file.pdf', undefined, [])).toBe('HTML');
    });
  });

  describe('명백한 비대상 확장자 → null', () => {
    it.each(['jpg', 'jpeg', 'png', 'gif', 'svg', 'zip', 'hwp', 'hwpx', 'doc', 'xls', 'ppt', 'mp4', 'mp3', 'css', 'js'])('.%s', (ext) => {
      expect(detectKind(`https://a.example/files/x.${ext}`, undefined, [])).toBeNull();
    });
    it('확장자가 없거나 알 수 없으면 HTML이다(/docs/, .html, .aspx, .do)', () => {
      expect(detectKind('https://a.example/docs/', undefined, [])).toBe('HTML');
      expect(detectKind('https://a.example/docs/index.html', undefined, [])).toBe('HTML');
      expect(detectKind('https://a.example/board/view.do', undefined, [])).toBe('HTML');
      expect(detectKind('https://a.example/board/view.aspx', undefined, [])).toBe('HTML');
    });
    it('확장자는 경로 끝에서만 본다(폴더 이름이 .pdf가 들어가도 끝이 다르면 HTML)', () => {
      expect(detectKind('https://a.example/docs/a.pdf/index', undefined, [])).toBe('HTML');
    });
  });

  describe('소스 fileTypes 필터 — 비어 있지 않으면 목록 안일 때만 그 종류', () => {
    it('비어 있으면 모든 문서 파일을 허용한다', () => {
      expect(detectKind('https://a.example/a.pdf', undefined, [])).toBe('PDF');
    });
    it('PDF만 허용하면 DOCX·XLSX·PPTX는 null(요청하지 않는다)', () => {
      expect(detectKind('https://a.example/a.pdf', undefined, ['PDF'])).toBe('PDF');
      expect(detectKind('https://a.example/a.docx', undefined, ['PDF'])).toBeNull();
      expect(detectKind('https://a.example/a.xlsx', undefined, ['PDF'])).toBeNull();
      expect(detectKind('https://a.example/a.pptx', undefined, ['PDF'])).toBeNull();
    });
    it('fileTypes가 있어도 HTML 판정에는 영향이 없다', () => {
      expect(detectKind('https://a.example/docs/', undefined, ['PDF'])).toBe('HTML');
    });
    it('여러 종류를 허용하면 목록 안의 것만 그 종류다', () => {
      expect(detectKind('https://a.example/a.docx', undefined, ['PDF', 'DOCX'])).toBe('DOCX');
      expect(detectKind('https://a.example/a.pptx', undefined, ['PDF', 'DOCX'])).toBeNull();
    });
  });

  // [pass 11 · L-E] 주의: 이 단언은 "바람직한 동작"이 아니라 **미구현 갭(RG-11 — 응답 Content-Type으로 종류를 다시 판정하지 않음)의 현재 상태를 고정**한 것이다. Content-Type을 판정에 쓰도록
  // 구현하면 이 시험은 실패해야 하며, 그때 기대값을 새 동작(예: `application/pdf` 응답은 PDF)에 맞춰 바꾼다 — 이 시험이 통과한다고 해서 갭이 없다는 뜻이 아니다.
  it('응답 Content-Type 인자는 아직 판정에 쓰지 않는다(RG-11 잔여) — 값이 달라도 결과가 같다', () => {
    expect(detectKind('https://a.example/docs/a', 'application/pdf', [])).toBe('HTML');
    expect(detectKind('https://a.example/docs/a.pdf', 'text/html', [])).toBe('PDF');
  });
});

describe('isFileUrl (pass 9 · L-7)', () => {
  it('문서 파일 확장자면 true — 소스 fileTypes 필터와 무관하다', () => {
    expect(isFileUrl('https://a.example/a.pdf')).toBe(true);
    expect(isFileUrl('https://a.example/a.DOCX')).toBe(true);
    expect(isFileUrl('https://a.example/a.xlsx?x=1')).toBe(true);
    expect(isFileUrl('https://a.example/a.pptx')).toBe(true);
  });
  it('HTML·비대상 확장자는 false(비대상은 HTML 기준으로 보수적으로)', () => {
    expect(isFileUrl('https://a.example/docs/')).toBe(false);
    expect(isFileUrl('https://a.example/download?file=a.pdf')).toBe(false);
    expect(isFileUrl('https://a.example/img/a.png')).toBe(false);
    expect(isFileUrl('https://a.example/a.zip')).toBe(false);
  });
});
