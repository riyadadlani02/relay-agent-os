import { openDB, type DBSchema } from 'idb';
import { newSession, type Session, type SessionStore } from './domain';

interface RelayDB extends DBSchema {
  sessions: { key: string; value: Session };
}
const db = () =>
  openDB<RelayDB>('relay-live-v1', 1, {
    upgrade(database) {
      database.createObjectStore('sessions', { keyPath: 'id' });
    },
  });
export async function openSession(fresh = false): Promise<SessionStore> {
  const database = await db();
  let key = fresh ? null : localStorage.getItem('relay-live-session');
  if (!key || !(await database.get('sessions', key))) {
    const session = newSession();
    await database.put('sessions', session);
    key = session.id;
    localStorage.setItem('relay-live-session', key);
  }
  const id = key;
  return {
    async read() {
      const session = await database.get('sessions', id);
      if (!session) throw new Error('Session is missing. Start a new session.');
      return session;
    },
    async update(change) {
      const transaction = database.transaction('sessions', 'readwrite');
      try {
        const session = await transaction.store.get(id);
        if (!session) throw new Error('Session is missing. Start a new session.');
        change(session);
        await transaction.store.put(session);
        await transaction.done;
        return session;
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          /* The transaction may already have aborted. */
        }
        await transaction.done.catch(() => undefined);
        throw error;
      }
    },
  };
}
