import { afterEach, describe, expect, it, vi } from 'vitest';
import { REVOKE_DELAY_MS, saveBlob } from './saveBlob';

describe('saveBlob — 다운로드가 끊기지 않게 지연 해제', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('click 직후에는 URL을 해제하지 않고 지연 뒤에 해제하며, 링크는 DOM에 붙였다 뗀다', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    let attachedAtClick = false;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      attachedAtClick = document.body.contains(this);
      expect(this.download).toBe('a.xlsx');
    });

    saveBlob(new Blob(['x']), 'a.xlsx');

    expect(attachedAtClick).toBe(true);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_DELAY_MS);
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });
});
