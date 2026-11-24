// Estado compartido de la entrada (lápiz, dedos, gestos)

/** Si alguna vez se usó un lápiz, el dedo ya no dibuja (rechazo de palma) y sirve para desplazar */
export const input = { penSeen: localStorage.getItem('nbs-pen-seen') === '1' };
export function markPen() {
  if (!input.penSeen) {
    input.penSeen = true;
    localStorage.setItem('nbs-pen-seen', '1');
  }
}

/** Se dispara cuando empieza un gesto de dos dedos: las hojas cancelan el trazo en curso */
export const gestureBus = new EventTarget();
export const cancelGestures = () => gestureBus.dispatchEvent(new Event('cancel'));
