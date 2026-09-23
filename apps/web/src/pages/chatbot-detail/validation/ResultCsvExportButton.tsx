import { MESSAGES } from '../../../constants/messages';

/** 결과·비교 CSV 내보내기 공용 버튼(ui-spec §4.4.1 `ResultCsvExportButton`). */
export function ResultCsvExportButton({ href }: { href: string }): JSX.Element {
  return (
    <a className="btn btn-secondary" href={href}>
      {MESSAGES.validation.common.exportCsv}
    </a>
  );
}
