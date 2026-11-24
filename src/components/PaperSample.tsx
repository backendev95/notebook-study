import type { PaperType } from '../types';

/** Muestra pequeña de un tipo de hoja */
export function PaperSample({ paper }: { paper: PaperType }) {
  return <span className={`paper-sample paper-${paper}`} aria-hidden />;
}
