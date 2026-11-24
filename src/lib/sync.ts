import { useSyncExternalStore } from 'react';
import { db, localChanges, remoteWrite, syncTables } from '../db';
import type { Asset, NoteElement, Notebook, Page } from '../types';
import { BUCKET, explainError, supabase } from './supabase';

/*
  Sincronización "local primero":
  - Todo se guarda primero en el dispositivo (IndexedDB) y funciona sin conexión.
  - Los cambios locales quedan marcados (dirty = 1) y se SUBEN a Supabase.
  - Luego se BAJA lo que otros dispositivos cambiaron desde la última vez
    (según server_updated_at).
  - Si dos dispositivos editan lo mismo, gana el cambio más reciente (updated_at);
    el servidor también lo hace cumplir con un trigger.
*/

export type SyncState = 'off' | 'idle' | 'syncing' | 'offline' | 'error';
export interface SyncStatus {
  state: SyncState;
  lastSync?: number;
  error?: string;
  pending: number;
}

type TableName = 'notebooks' | 'pages' | 'elements' | 'assets';
// Orden de subida: primero los contenedores, luego el contenido
const ORDER: TableName[] = ['notebooks', 'pages', 'assets', 'elements'];
const CHUNK = 200;
const OVERLAP_MS = 5000; // margen al pedir cambios para no perder escrituras simultáneas

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------- Conversión local <-> nube ----------
type Row = Record<string, unknown>;

function toRemote(table: TableName, l: Row): Row {
  switch (table) {
    case 'notebooks': {
      const n = l as unknown as Notebook;
      return {
        id: n.id,
        title: n.title,
        color: n.color,
        created_at: n.createdAt,
        updated_at: n.updatedAt,
        deleted: !!n.deleted,
      };
    }
    case 'pages': {
      const p = l as unknown as Page;
      return { id: p.id, notebook_id: p.notebookId, position: p.order, updated_at: p.updatedAt, deleted: !!p.deleted };
    }
    case 'elements': {
      const { id, pageId, type, updatedAt, deleted, dirty: _d, ...data } = l as unknown as NoteElement & Row;
      void _d;
      if (type === 'ink') data.points = (data.points as number[][]).map(([x, y, p]) => [r1(x), r1(y), r2(p)]);
      return { id, page_id: pageId, type, data, updated_at: updatedAt, deleted: !!deleted };
    }
    case 'assets': {
      const a = l as unknown as Asset;
      return { id: a.id, mime: a.mime, path: '', updated_at: a.updatedAt, deleted: false };
    }
  }
}

function toLocal(table: TableName, r: Row): Row {
  switch (table) {
    case 'notebooks':
      return {
        id: r.id,
        title: r.title,
        color: r.color,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        deleted: r.deleted,
        dirty: 0,
      };
    case 'pages':
      return {
        id: r.id,
        notebookId: r.notebook_id,
        order: r.position,
        updatedAt: Number(r.updated_at),
        deleted: r.deleted,
        dirty: 0,
      };
    case 'elements':
      return {
        ...(r.data as Row),
        id: r.id,
        pageId: r.page_id,
        type: r.type,
        updatedAt: Number(r.updated_at),
        deleted: r.deleted,
        dirty: 0,
      };
    case 'assets':
      throw new Error('assets se manejan aparte');
  }
}

// ---------- Motor ----------
class SyncEngine {
  private status: SyncStatus = { state: 'off', pending: 0 };
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private running = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private fetching = new Map<string, Promise<void>>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getStatus = () => this.status;
  private set(s: Partial<SyncStatus>) {
    this.status = { ...this.status, ...s };
    this.listeners.forEach((l) => l());
  }

  // Mientras escribes o dibujas se agrupan los cambios: se sube 4 s después del último
  // trazo, y como máximo 15 s después del primero (para no perder nada si no paras).
  private firstChangeAt = 0;
  private onLocalChange = () => {
    const now = Date.now();
    if (!this.firstChangeAt) this.firstChangeAt = now;
    this.request(Math.max(0, Math.min(4000, 15_000 - (now - this.firstChangeAt))));
  };
  private onOnline = () => this.request(100);
  private onVisible = () => document.visibilityState === 'visible' && this.request(100);

  /** Empieza a sincronizar para este usuario */
  async start(userId: string) {
    if (!supabase || this.userId === userId) return;
    this.stop();
    // Si en este dispositivo había datos de OTRO usuario, se borran antes de continuar
    const owner = localStorage.getItem('nbs-owner');
    if (owner && owner !== userId) await this.clearLocal();
    localStorage.setItem('nbs-owner', userId);
    this.userId = userId;
    localChanges.addEventListener('change', this.onLocalChange);
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
    // revisar cambios de otros dispositivos cada 45 s, solo con la app a la vista
    this.interval = setInterval(() => document.visibilityState === 'visible' && this.request(0), 45_000);
    this.set({ state: 'idle', error: undefined });
    this.request(0);
  }

  stop() {
    this.userId = null;
    clearTimeout(this.timer);
    clearInterval(this.interval);
    localChanges.removeEventListener('change', this.onLocalChange);
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.set({ state: 'off', error: undefined });
  }

  /** Programa una sincronización (agrupa cambios seguidos) */
  request(delay = 0) {
    if (!this.userId) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), delay);
  }

  async run() {
    if (!this.userId || !supabase) return;
    if (this.running) {
      this.again = true;
      return;
    }
    if (!navigator.onLine) {
      this.set({ state: 'offline', pending: await this.countPending() });
      return;
    }
    this.running = true;
    this.firstChangeAt = 0;
    // "Sincronizando…" solo aparece si tarda; las sincronizaciones rápidas no se notan
    const showBusy = setTimeout(() => this.set({ state: 'syncing' }), 800);
    try {
      await this.push();
      await this.pull();
      this.set({ state: 'idle', lastSync: Date.now(), error: undefined, pending: await this.countPending() });
    } catch (e) {
      const error = explainError(e);
      this.set({
        state: /Sin conexión/.test(error) ? 'offline' : 'error',
        error,
        pending: await this.countPending(),
      });
    } finally {
      clearTimeout(showBusy);
      this.running = false;
      if (this.again) {
        this.again = false;
        this.request(300);
      }
    }
  }

  async countPending() {
    let n = 0;
    for (const t of syncTables()) n += await t.where('dirty').equals(1).count();
    return n;
  }

  // ----- Subir -----
  private async push() {
    const sb = supabase!;
    for (const name of ORDER) {
      const table = db.table(name);
      const rows = (await table.where('dirty').equals(1).toArray()) as Row[];
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        if (name === 'assets') {
          for (const a of chunk as unknown as Asset[]) {
            const path = `${this.userId}/${a.id}`;
            const up = await sb.storage.from(BUCKET).upload(path, a.blob, { upsert: true, contentType: a.mime });
            if (up.error) throw up.error;
          }
        }
        const payload = chunk.map((r) => {
          const out = toRemote(name, r);
          if (name === 'assets') out.path = `${this.userId}/${r.id}`;
          return out;
        });
        const { error } = await sb.from(name).upsert(payload, { onConflict: 'id' });
        if (error) throw error;
        // marcar como subidos solo si no cambiaron mientras tanto
        await remoteWrite(async () => {
          for (const r of chunk) {
            const cur = (await table.get(r.id as string)) as Row | undefined;
            if (cur && cur.updatedAt === r.updatedAt) await table.update(r.id as string, { dirty: 0 });
          }
        });
      }
    }
  }

  // ----- Bajar -----
  private cursorKey(name: TableName) {
    return `nbs-cursor-${this.userId}-${name}`;
  }

  private async pull() {
    const sb = supabase!;
    for (const name of ORDER) {
      let cursor = localStorage.getItem(this.cursorKey(name)) ?? '1970-01-01T00:00:00Z';
      for (;;) {
        const since = new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString();
        const { data, error } = await sb
          .from(name)
          .select('*')
          .gt('server_updated_at', since)
          .order('server_updated_at', { ascending: true })
          .limit(1000);
        if (error) throw error;
        if (!data?.length) break;
        if (name === 'assets') await this.mergeAssets(data);
        else await this.merge(name, data);
        const last = data[data.length - 1].server_updated_at as string;
        if (last === cursor) break; // nada nuevo después del margen
        cursor = last;
        localStorage.setItem(this.cursorKey(name), cursor);
        if (data.length < 1000) break;
      }
    }
  }

  private async merge(name: TableName, remote: Row[]) {
    const table = db.table(name);
    await remoteWrite(async () => {
      for (const r of remote) {
        const local = (await table.get(r.id as string)) as Row | undefined;
        const incoming = toLocal(name, r);
        // gana el más reciente; si es la misma versión que ya está aquí, no se toca
        // (evita redibujar la pantalla sin necesidad)
        if (!local || (incoming.updatedAt as number) > (local.updatedAt as number)) await table.put(incoming);
      }
    });
  }

  private async mergeAssets(remote: Row[]) {
    for (const r of remote) {
      if (await db.assets.get(r.id as string)) continue;
      // se descargan en segundo plano; si falla, se reintenta cuando la imagen se necesite
      this.fetchAsset(r.id as string, r.path as string).catch(() => undefined);
    }
  }

  /** Descarga una imagen que este dispositivo todavía no tiene */
  fetchAsset(id: string, knownPath?: string): Promise<void> {
    const sb = supabase;
    if (!sb || !this.userId) return Promise.resolve();
    const existing = this.fetching.get(id);
    if (existing) return existing;
    const job = (async () => {
      let path = knownPath;
      if (!path) {
        const { data } = await sb.from('assets').select('path').eq('id', id).maybeSingle();
        path = data?.path as string | undefined;
      }
      if (!path) return;
      const { data: blob, error } = await sb.storage.from(BUCKET).download(path);
      if (error || !blob) throw error ?? new Error('descarga vacía');
      await remoteWrite(async () => {
        if (!(await db.assets.get(id)))
          await db.assets.put({ id, blob, mime: blob.type, updatedAt: Date.now(), dirty: 0 });
      });
    })().finally(() => this.fetching.delete(id));
    this.fetching.set(id, job);
    return job;
  }

  /** Borra los datos de este dispositivo (al cerrar sesión o cambiar de usuario) */
  async clearLocal() {
    await remoteWrite(async () => {
      for (const t of syncTables()) await t.clear();
    });
    for (const k of Object.keys(localStorage))
      if (k.startsWith('nbs-cursor-') || k.startsWith('nbs-last-')) localStorage.removeItem(k);
    localStorage.removeItem('nbs-owner');
  }

  /** Sube lo pendiente y luego limpia el dispositivo. Devuelve false si quedó algo sin subir. */
  async signOutAndClear(): Promise<boolean> {
    if (this.userId) {
      await this.run();
      if ((await this.countPending()) > 0) return false;
    }
    this.stop();
    await supabase?.auth.signOut();
    await this.clearLocal();
    return true;
  }
}

export const sync = new SyncEngine();

export function useSyncStatus() {
  return useSyncExternalStore(sync.subscribe, sync.getStatus);
}
