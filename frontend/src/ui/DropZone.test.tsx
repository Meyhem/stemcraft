import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DropZone } from './DropZone';

const mp3 = () => new File(['bytes'], 'song.mp3', { type: 'audio/mpeg' });

test('choosing a file through the input reports it', async () => {
  const onFile = vi.fn();
  render(<DropZone id="f" label="Audio or video file" file={null} onFile={onFile} />);
  await userEvent.upload(screen.getByLabelText('Audio or video file'), mp3());
  expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'song.mp3' }));
});

test('dropping a file reports it and cancels the browser default', () => {
  // Without preventDefault on drop the browser navigates away to the dropped file,
  // which loses the whole page. That is the bug this asserts against, and it is
  // invisible in jsdom unless the call is checked directly.
  const onFile = vi.fn();
  const { container } = render(<DropZone id="f" label="File" file={null} onFile={onFile} />);
  const zone = container.querySelector('.drop')!;
  const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [mp3()] } });

  fireEvent(zone, dropEvent);

  expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'song.mp3' }));
  expect(dropEvent.defaultPrevented).toBe(true);
});

test('dragging over marks the zone and leaving unmarks it', () => {
  const { container } = render(<DropZone id="f" label="File" file={null} onFile={vi.fn()} />);
  const zone = container.querySelector('.drop')!;
  fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
  expect(zone).toHaveAttribute('data-over', 'true');
  fireEvent.dragLeave(zone);
  expect(zone).toHaveAttribute('data-over', 'false');
});

test('the chosen file name is shown instead of the prompt', () => {
  render(<DropZone id="f" label="File" file={mp3()} onFile={vi.fn()} />);
  expect(screen.getByText('song.mp3')).toBeInTheDocument();
  expect(screen.queryByText(/drop a file here/i)).toBeNull();
});

test('the input carries no accept filter', () => {
  // There is no format whitelist -- if ffmpeg decodes it, it is accepted. An accept
  // filter would silently hide video containers the pipeline handles fine.
  render(<DropZone id="f" label="File" file={null} onFile={vi.fn()} />);
  expect(screen.getByLabelText('File')).not.toHaveAttribute('accept');
});
