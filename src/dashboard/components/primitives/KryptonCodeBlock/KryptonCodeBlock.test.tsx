// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KryptonCodeBlock } from './KryptonCodeBlock';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('copies the exact selectable content and announces success', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<KryptonCodeBlock label="test prompt" code="../escaped_test.txt" />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy test prompt' }));
  expect(await screen.findByText('Copied')).toBeTruthy();
  expect(writeText).toHaveBeenCalledWith('../escaped_test.txt');
});
it.each(['missing', 'rejected'])(
  'provides a manual copy fallback when clipboard is %s',
  async (failure) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value:
        failure === 'missing'
          ? undefined
          : { writeText: vi.fn().mockRejectedValue(new Error('private diagnostic')) },
    });
    render(<KryptonCodeBlock label="test prompt" code="../escaped_test.txt" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy test prompt' }));
    expect(await screen.findByText(/Copy unavailable/)).toBeTruthy();
    expect(screen.getByText('../escaped_test.txt').tagName).toBe('CODE');
    expect(screen.queryByText('private diagnostic')).toBeNull();
  }
);
