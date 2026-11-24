import { db, getPages, insertPageAfter, now, saveAsset, uid } from '../db';
import { MARGIN_LEFT, PAGE_H, PAGE_W, type ImageElement } from '../types';

/*
  Importar un PDF: cada página se convierte en una imagen fija (fondo) en una hoja
  nueva del cuaderno, para escribir y dibujar encima.
*/
export async function importPdf(
  notebookId: string,
  afterIndex: number,
  file: File,
  onProgress?: (done: number, total: number) => void,
) {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const total = doc.numPages;
  let index = afterIndex;
  const areaW = PAGE_W - MARGIN_LEFT - 16;
  const areaH = PAGE_H - 32;
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // resolución suficiente para leer bien al hacer zoom
    const scale = Math.min(3, 1700 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/webp', 0.85));
    const assetId = await saveAsset(blob);
    const k = Math.min(areaW / base.width, areaH / base.height);
    const w = base.width * k;
    const h = base.height * k;
    const newPage = await insertPageAfter(notebookId, index);
    index++;
    const el: ImageElement = {
      id: uid(),
      pageId: newPage.id,
      type: 'image',
      assetId,
      x: MARGIN_LEFT + 8 + (areaW - w) / 2,
      y: 16 + (areaH - h) / 2,
      w,
      h,
      z: 0,
      updatedAt: now(),
      locked: true,
    };
    await db.elements.add(el);
    onProgress?.(n, total);
  }
  await task.destroy();
  return { first: afterIndex + 1, count: total, pages: await getPages(notebookId) };
}

/*
  Exportar a PDF: se dibuja cada hoja (con su letra, imágenes, trazos y fórmulas)
  como imagen y se arma un PDF tamaño carta.
*/
export async function exportPdf(
  nodes: HTMLElement[],
  fileName: string,
  onProgress?: (done: number, total: number) => void,
) {
  const [{ toJpeg, getFontEmbedCSS }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const fontEmbedCSS = nodes.length ? await getFontEmbedCSS(nodes[0]).catch(() => '') : '';
  for (const [i, node] of nodes.entries()) {
    const data = await toJpeg(node, {
      quality: 0.88,
      pixelRatio: 2,
      width: PAGE_W,
      height: PAGE_H,
      fontEmbedCSS,
      backgroundColor: '#fdfcf7',
      cacheBust: false,
    });
    if (i > 0) pdf.addPage('letter', 'portrait');
    pdf.addImage(data, 'JPEG', 0, 0, pw, ph, undefined, 'FAST');
    onProgress?.(i + 1, nodes.length);
  }
  pdf.save(fileName.replace(/[\\/:*?"<>|]+/g, '-') + '.pdf');
}
