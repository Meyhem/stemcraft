// §6: the socket carries liveness, never data. Every message means "refetch".
// Dropping it costs nothing but freshness, and the cache recovers on reconnect.
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

const RECONNECT_MS = 1000;

export function attachJobStream(client: QueryClient): () => void {
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const connect = () => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${scheme}://${location.host}/api/ws`);
    socket.onmessage = () => {
      void client.invalidateQueries({ queryKey: ['jobs'] });
    };
    socket.onclose = () => {
      if (!closed) timer = setTimeout(connect, RECONNECT_MS);
    };
  };

  connect();
  return () => {
    closed = true;
    clearTimeout(timer);
    socket?.close();
  };
}

export function useJobStream(): void {
  const client = useQueryClient();
  useEffect(() => attachJobStream(client), [client]);
}
