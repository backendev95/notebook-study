import { useSyncExternalStore } from 'react';

// Instalar la app (PWA). Android/Chrome/Edge disparan `beforeinstallprompt`;
// en iPhone/iPad hay que hacerlo a mano desde Safari (Compartir → Agregar a inicio).
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let snapshot = { canPrompt: false, installed: false, ios: false };
function compute() {
  const next = { canPrompt: !!deferred, installed: isStandalone(), ios: isIOS() };
  if (next.canPrompt !== snapshot.canPrompt || next.installed !== snapshot.installed || next.ios !== snapshot.ios)
    snapshot = next;
  return snapshot;
}

export function useInstall() {
  const state = useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, compute);
  const install = async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    notify();
    return outcome === 'accepted';
  };
  return { ...state, install };
}
