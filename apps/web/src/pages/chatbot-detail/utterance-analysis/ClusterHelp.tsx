import { MESSAGES } from '../../../constants/messages';

/** "묶음이란?" 펼침 도움말 — 화면에서 "토픽"이라는 말이 나오는 유일한 곳이다(DC-15). */
export function ClusterHelp(): JSX.Element {
  return (
    <details className="ua-help">
      <summary>{MESSAGES.utteranceAnalysis.clusterHelpSummary}</summary>
      <p>{MESSAGES.utteranceAnalysis.clusterHelp}</p>
    </details>
  );
}
