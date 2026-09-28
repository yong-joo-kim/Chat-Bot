import { isPreviewConfigStale } from './preview-stale';

describe('isPreviewConfigStale — R1 M-1', () => {
  it('같으면 낡지 않았다', () => {
    expect(isPreviewConfigStale(3, 3)).toBe(false);
  });
  it('다르면(더 낮아도·더 높아도) 낡았다', () => {
    expect(isPreviewConfigStale(2, 3)).toBe(true);
    expect(isPreviewConfigStale(4, 3)).toBe(true);
  });
});
