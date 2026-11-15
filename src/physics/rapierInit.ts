import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<typeof RAPIER> | null = null;

export function initRapier(): Promise<typeof RAPIER> {
  if (!ready) {
    ready = RAPIER.init().then(() => RAPIER);
  }
  return ready;
}
