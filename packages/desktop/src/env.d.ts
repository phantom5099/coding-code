import type { ElectronAPI } from '../electron/preload';

declare module '*.css';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
