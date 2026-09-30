import { useState } from 'react';
import { utteranceAnalysesApi } from '../../../api/utteranceAnalyses';
import { MESSAGES } from '../../../constants/messages';
import { useToast } from '../../../components/Toast';
import { saveBlob } from './saveBlob';

/** 양식 받기(엑셀·CSV) 2개 버튼 — `dialogue:read`라 읽기 전용 역할도 쓴다. 실패는 버튼 옆 글자로 알린다. */
export function TemplateDownloadButtons({ chatbotId, emphasize = false }: { chatbotId: string; emphasize?: boolean }): JSX.Element {
  const msg = MESSAGES.utteranceAnalysis;
  const { showToast } = useToast();
  const [busy, setBusy] = useState<'xlsx' | 'csv' | null>(null);
  const [failed, setFailed] = useState(false);

  async function handle(format: 'xlsx' | 'csv'): Promise<void> {
    setBusy(format);
    setFailed(false);
    try {
      const file = await utteranceAnalysesApi.downloadTemplate(chatbotId, format);
      saveBlob(file.blob, file.filename);
      showToast(msg.templateDownloaded);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  const cls = `btn ${emphasize ? 'btn-primary' : 'btn-secondary'}`;
  return (
    <div className="ua-template-buttons">
      <button type="button" className={cls} onClick={() => void handle('xlsx')} disabled={busy !== null}>
        {msg.templateXlsx}
      </button>
      <button type="button" className={cls} onClick={() => void handle('csv')} disabled={busy !== null}>
        {msg.templateCsv}
      </button>
      {failed && (
        <p className="field-error" role="alert">
          <span aria-hidden="true">⚠</span> {msg.templateFailed}
        </p>
      )}
    </div>
  );
}
