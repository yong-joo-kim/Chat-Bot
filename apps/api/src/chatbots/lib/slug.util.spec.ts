import { deriveCopySlug, SlugDerivationExhaustedError } from './slug.util';

describe('deriveCopySlug', () => {
  it('returns "{slug}-copy" when the copy slug is free (AC-1-7)', async () => {
    const slug = await deriveCopySlug('order-bot', async () => false);
    expect(slug).toBe('order-bot-copy');
  });

  it('increments to "-copy-2" when "-copy" is already taken (AC-1-8)', async () => {
    const taken = new Set(['order-bot-copy']);
    const slug = await deriveCopySlug('order-bot', async (candidate) => taken.has(candidate));
    expect(slug).toBe('order-bot-copy-2');
  });

  it('keeps incrementing past multiple collisions without ever raising 409', async () => {
    const taken = new Set(['order-bot-copy', 'order-bot-copy-2', 'order-bot-copy-3']);
    const slug = await deriveCopySlug('order-bot', async (candidate) => taken.has(candidate));
    expect(slug).toBe('order-bot-copy-4');
  });

  it('clamps the base slug so the derived slug never exceeds 50 chars (EX-1-7)', async () => {
    const longSlug = 'a'.repeat(50);
    const slug = await deriveCopySlug(longSlug, async () => false);
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug.endsWith('-copy')).toBe(true);
  });

  it('throws SlugDerivationExhaustedError after exhausting 999 attempts', async () => {
    await expect(deriveCopySlug('order-bot', async () => true)).rejects.toBeInstanceOf(
      SlugDerivationExhaustedError,
    );
  });
});
