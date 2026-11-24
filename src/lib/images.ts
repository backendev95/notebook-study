import { db, imageSize, nextZ, now, saveAsset, uid } from '../db';
import { addElements } from './history';
import { MARGIN_LEFT, PAGE_H, PAGE_W } from '../types';
import { useEffect, useState } from 'react';
import { sync } from './sync';

const MAX_SIDE = 1800;

/** Reduce fotos muy grandes antes de guardarlas (menos espacio y sincronización más rápida) */
export async function compress(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/gif' || blob.type === 'image/svg+xml') return blob;
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (k === 1 && blob.size < 1_500_000) return blob;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.86));
    return out ?? blob;
  } catch {
    return blob;
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Pega una imagen en la hoja. `at` es el punto central en coordenadas de página. */
export async function insertImage(pageId: string, file: Blob, at?: { x: number; y: number }) {
  const blob = await compress(file);
  const assetId = await saveAsset(blob);
  const nat = await imageSize(blob);
  const k = Math.min(1, 380 / nat.w, 460 / nat.h);
  const w = Math.max(60, nat.w * k);
  const h = (w * nat.h) / nat.w;
  const cx = at?.x ?? PAGE_W / 2 + (Math.random() - 0.5) * 80;
  const cy = at?.y ?? PAGE_H / 2 + (Math.random() - 0.5) * 80;
  await addElements([{
    id: uid(),
    pageId,
    type: 'image',
    assetId,
    x: clamp(cx - w / 2, MARGIN_LEFT + 6, PAGE_W - w - 6),
    y: clamp(cy - h / 2, 6, PAGE_H - h - 6),
    w,
    h,
    z: await nextZ(pageId),
    updatedAt: now(),
  }]);
}

const urlCache = new Map<string, string>();

export function useAssetUrl(assetId: string) {
  const [url, setUrl] = useState(() => urlCache.get(assetId));
  useEffect(() => {
    if (!assetId) return;
    const cached = urlCache.get(assetId);
    if (cached) {
      setUrl(cached);
      return;
    }
    let alive = true;
    const load = async (retry: boolean) => {
      const a = await db.assets.get(assetId);
      if (!alive) return;
      if (!a) {
        // la imagen se pegó en otro dispositivo: la bajamos de la nube
        if (retry) await sync.fetchAsset(assetId).catch(() => undefined);
        if (retry) load(false);
        return;
      }
      const u = URL.createObjectURL(a.blob);
      urlCache.set(assetId, u);
      setUrl(u);
    };
    load(true);
    return () => {
      alive = false;
    };
  }, [assetId]);
  return url;
}
