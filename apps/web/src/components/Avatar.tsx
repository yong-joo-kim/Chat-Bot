import { useState } from 'react';

/**
 * 아바타 URL이 없거나 로드에 실패하면 이름 첫 글자 이니셜로 대체한다(FR-3-3, EX-3-2).
 * 이미지 로드 실패는 콘솔에만 남기고 화면은 깨지지 않는다.
 */
export function Avatar({ name, avatarUrl, size = 36 }: { name: string; avatarUrl?: string; size?: number }): JSX.Element {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0) || '?';

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="avatar-image"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className="avatar-initial" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
      {initial}
    </span>
  );
}
