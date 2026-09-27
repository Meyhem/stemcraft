import { QueryClient } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';

import { attachJobStream } from './useJobStream';

class FakeSocket {
  static last: FakeSocket | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    FakeSocket.last = this;
  }
}

test('a message invalidates the jobs cache and nothing else', () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  vi.stubGlobal('WebSocket', FakeSocket);

  const detach = attachJobStream(client);
  FakeSocket.last!.onmessage!({ data: '{"type":"jobs","jobs":[]}' } as MessageEvent);

  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['jobs'] });
  expect(invalidate).toHaveBeenCalledTimes(1);
  detach();
});

test('connects same-origin over the right scheme', () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  const detach = attachJobStream(new QueryClient());
  expect(FakeSocket.last!.url).toBe(`ws://${location.host}/api/ws`);
  detach();
});
