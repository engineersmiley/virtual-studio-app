export function createRemoteControlLifetime(): {
  isAllowed(): boolean;
  setAllowed(next: boolean): void;
  cancel(group?: string): void;
  schedule(group: string, callback: () => void, delay: number): void;
};
