import { DurableObject } from 'cloudflare:workers';
import type { DebateEvent } from './events';

const BLOCKED_KEY = 'blocked';

/**
 * One per Debate. Holds Viewer WebSockets with the hibernation API and relays events sent by the Queue consumer.
 * It stores no Debate state (only whether a Moderator Blocked it) and makes no model calls (ADR 0003).
 */
export class DebateRoom extends DurableObject<Env> {
  private async isBlocked(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>(BLOCKED_KEY)) === true;
  }

  override async fetch(_request: Request): Promise<Response> {
    // An upgrade that passed the API's Block check just before a Block can arrive just after it.
    if (await this.isBlocked()) return Response.json({ error: 'This Debate was blocked by a Moderator' }, { status: 410 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** RPC from the consumer. Returns how many Viewers the event was sent to. */
  async broadcast(event: DebateEvent): Promise<number> {
    if (await this.isBlocked()) return 0;
    const message = JSON.stringify(event);
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
        sent += 1;
      } catch {
        // A socket that closed mid-broadcast is cleaned up by the runtime.
      }
    }
    return sent;
  }

  /** RPC after a Block: tells every Viewer, then closes their sockets (code 4410, like HTTP 410 Gone). */
  async closeForBlock(): Promise<void> {
    // Remembered, so the room stays closed: no new sockets, no more events for this Debate.
    await this.ctx.storage.put(BLOCKED_KEY, true);
    const message = JSON.stringify({ type: 'blocked' } satisfies DebateEvent);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
        ws.close(4410, 'Blocked by a Moderator');
      } catch {
        // Already closed.
      }
    }
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
  }

  // No webSocketClose handler: with compatibility_date >= 2026-04-07 the runtime replies to close frames itself
  // (web_socket_auto_reply_to_close). Echoing the code back fails for closes without a code (1005).
}
