let paused = false;

export function getVaultPaused(): boolean {
  return paused;
}

export function setVaultPaused(value: boolean): void {
  paused = value;
}
