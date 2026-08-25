import { Injectable } from '@nestjs/common';
import {
  listRoom,
  RealtimeEvent,
  zoneRoom,
  type ListPresence,
  type PresenceEditor,
  type PresenceUser,
  type ZonePresence,
} from '@portfolio/luna-shopper/contracts';
import { EventRelayService } from '../relay/event-relay.service';

/** What one connected socket is currently present on. */
interface SocketPresence {
  userId: string;
  zones: Set<string>;
  lists: Set<string>;
  /** listId to the line the socket is editing on that list (one at a time). */
  editing: Map<string, string>;
}

/**
 * Tracks and broadcasts presence (plan 0009, section 7): who is online in a zone,
 * and who is viewing or editing a list right now.
 *
 * Presence is ephemeral, in-memory state for the single replica this service runs
 * as today; when Redis is added (section 9) it moves to a shared store so it is
 * correct across replicas. A user may hold several sockets, so each fact is kept
 * as a set of socket ids and a user counts as present while any of their sockets
 * is. Every change re-broadcasts the affected room's full snapshot through the
 * relay, so both socket and SSE clients converge on the same view.
 */
@Injectable()
export class PresenceService {
  private readonly sockets = new Map<string, SocketPresence>();
  private readonly zoneOnline = new Map<string, Map<string, Set<string>>>();
  private readonly listViewers = new Map<string, Map<string, Set<string>>>();
  private readonly listEditors = new Map<string, Map<string, PresenceEditor>>();

  constructor(private readonly relay: EventRelayService) {}

  /** Remember an authenticated socket so later signals can resolve its user. */
  register(socketId: string, userId: string): void {
    this.sockets.set(socketId, {
      userId,
      zones: new Set(),
      lists: new Set(),
      editing: new Map(),
    });
  }

  joinZone(socketId: string, zoneId: string): void {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    socket.zones.add(zoneId);
    this.addNested(this.zoneOnline, zoneId, socket.userId, socketId);
    this.broadcastZone(zoneId);
  }

  leaveZone(socketId: string, zoneId: string): void {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    socket.zones.delete(zoneId);
    this.removeNested(this.zoneOnline, zoneId, socket.userId, socketId);
    this.broadcastZone(zoneId);
  }

  viewList(socketId: string, listId: string): void {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    socket.lists.add(listId);
    this.addNested(this.listViewers, listId, socket.userId, socketId);
    this.broadcastList(listId);
  }

  unviewList(socketId: string, listId: string): void {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    socket.lists.delete(listId);
    socket.editing.delete(listId);
    this.removeNested(this.listViewers, listId, socket.userId, socketId);
    this.listEditors.get(listId)?.delete(socketId);
    this.broadcastList(listId);
  }

  editLine(socketId: string, listId: string, lineId: string): void {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    socket.editing.set(listId, lineId);
    const editors = this.getOrCreate(this.listEditors, listId);
    editors.set(socketId, { userId: socket.userId, lineId });
    this.broadcastList(listId);
  }

  stopEditLine(socketId: string, listId: string): void {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    socket.editing.delete(listId);
    this.listEditors.get(listId)?.delete(socketId);
    if (this.listEditors.get(listId)?.size === 0) {
      this.listEditors.delete(listId);
    }
    this.broadcastList(listId);
  }

  /** Drop a disconnected socket from every room and rebroadcast what changed. */
  disconnect(socketId: string): void {
    const socket = this.sockets.get(socketId);
    if (!socket) {
      return;
    }
    for (const zoneId of socket.zones) {
      this.removeNested(this.zoneOnline, zoneId, socket.userId, socketId);
      this.broadcastZone(zoneId);
    }
    for (const listId of socket.lists) {
      this.removeNested(this.listViewers, listId, socket.userId, socketId);
      this.listEditors.get(listId)?.delete(socketId);
      this.broadcastList(listId);
    }
    this.sockets.delete(socketId);
  }

  private broadcastZone(zoneId: string): void {
    const online: PresenceUser[] = [
      ...(this.zoneOnline.get(zoneId)?.keys() ?? []),
    ].map((userId) => ({ userId }));
    const payload: ZonePresence = { zoneId, online };
    this.relay.publish({
      rooms: [zoneRoom(zoneId)],
      event: RealtimeEvent.PresenceZoneUpdated,
      payload,
    });
  }

  private broadcastList(listId: string): void {
    const viewers: PresenceUser[] = [
      ...(this.listViewers.get(listId)?.keys() ?? []),
    ].map((userId) => ({ userId }));
    const editors = [...(this.listEditors.get(listId)?.values() ?? [])];
    const payload: ListPresence = {
      listId,
      viewers,
      editors: this.dedupeEditors(editors),
    };
    this.relay.publish({
      rooms: [listRoom(listId)],
      event: RealtimeEvent.PresenceListUpdated,
      payload,
    });
  }

  /** Collapse several sockets of one user editing the same line into one entry. */
  private dedupeEditors(editors: PresenceEditor[]): PresenceEditor[] {
    const byKey = new Map<string, PresenceEditor>();
    for (const editor of editors) {
      byKey.set(`${editor.userId}:${editor.lineId}`, editor);
    }
    return [...byKey.values()];
  }

  private getOrCreate<V>(map: Map<string, Map<string, V>>, key: string) {
    let inner = map.get(key);
    if (!inner) {
      inner = new Map<string, V>();
      map.set(key, inner);
    }
    return inner;
  }

  private addNested(
    map: Map<string, Map<string, Set<string>>>,
    key: string,
    userId: string,
    socketId: string
  ): void {
    const users = this.getOrCreate(map, key);
    let sockets = users.get(userId);
    if (!sockets) {
      sockets = new Set<string>();
      users.set(userId, sockets);
    }
    sockets.add(socketId);
  }

  private removeNested(
    map: Map<string, Map<string, Set<string>>>,
    key: string,
    userId: string,
    socketId: string
  ): void {
    const users = map.get(key);
    const sockets = users?.get(userId);
    if (!users || !sockets) {
      return;
    }
    sockets.delete(socketId);
    if (sockets.size === 0) {
      users.delete(userId);
    }
    if (users.size === 0) {
      map.delete(key);
    }
  }
}
