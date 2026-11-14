// The live connection to a Debate's room. Events are DebateEvents; the room answers our "ping" with a pong.
import type { DebateEvent } from '@debate-arena/api-client';

export type LiveStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface LiveHandlers {
  onEvent(event: DebateEvent): void;
  onStatus(status: LiveStatus): void;
}

export interface LiveOptions {
  WebSocketImpl?: typeof WebSocket;
  retryMs?: number;
  maxRetries?: number;
  /** Keeps idle connections from being dropped by proxies. */
  pingMs?: number;
}

export function liveUrl(location: Pick<Location, 'protocol' | 'host'>, debateId: string): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/api/debates/${encodeURIComponent(debateId)}/live`;
}

/** Connects and reconnects after unexpected closes (up to maxRetries in a row) until `close()` is called. */
export function connectLive(url: string, handlers: LiveHandlers, options: LiveOptions = {}): { close(): void } {
  const { WebSocketImpl = WebSocket, retryMs = 2000, maxRetries = 10, pingMs = 30_000 } = options;
  let socket: WebSocket | null = null;
  let retries = 0;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const open = () => {
    handlers.onStatus(retries === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocketImpl(url);
    socket = ws;
    ws.onopen = () => {
      retries = 0;
      handlers.onStatus('open');
      pingTimer = setInterval(() => ws.send('ping'), pingMs);
    };
    ws.onmessage = message => {
      let event: unknown;
      try {
        event = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (typeof event !== 'object' || event === null || (event as { type?: unknown }).type === 'pong') return;
      handlers.onEvent(event as DebateEvent);
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      if (stopped) return;
      if (retries >= maxRetries) {
        stopped = true;
        handlers.onStatus('closed');
        return;
      }
      retries += 1;
      handlers.onStatus('reconnecting');
      retryTimer = setTimeout(open, retryMs);
    };
  };

  open();
  return {
    close() {
      if (stopped) return;
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      socket?.close();
      handlers.onStatus('closed');
    },
  };
}
