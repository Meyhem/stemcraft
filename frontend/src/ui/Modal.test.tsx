import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { Modal } from './Modal';

test('opens as a modal dialog named by its title', () => {
  render(<Modal title="Add song" onClose={() => {}}>body</Modal>);
  expect(screen.getByRole('dialog', { name: 'Add song' })).toHaveAttribute('open');
});

test('the close button, Esc and a backdrop click all close it', async () => {
  const onClose = vi.fn();
  render(<Modal title="Add song" onClose={onClose}><p>body</p></Modal>);
  const dialog = screen.getByRole('dialog');

  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  fireEvent.click(dialog);
  expect(onClose).toHaveBeenCalledTimes(3);

  fireEvent.click(screen.getByText('body'));
  expect(onClose).toHaveBeenCalledTimes(3);
});

test('focuses the element marked data-autofocus once open', () => {
  render(
    <Modal title="T" onClose={() => {}}>
      <input aria-label="first" data-autofocus />
    </Modal>,
  );
  expect(document.activeElement).toBe(screen.getByLabelText('first'));
});

test('without a marked element focus is left to the browser', () => {
  render(<Modal title="T" onClose={() => {}}><input aria-label="first" /></Modal>);
  expect(document.activeElement).not.toBe(screen.getByLabelText('first'));
});
