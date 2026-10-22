import { AppError } from './errors';

export const THEME_KEY = 'uiTheme';
export type ThemePreference = 'system' | 'light' | 'dark';
export function themePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export interface ThemeStore {
  read(): Promise<ThemePreference>;
  write(value: ThemePreference): Promise<void>;
  subscribe(listener: (value: ThemePreference) => void): () => void;
}
export interface ThemeStorage {
  get(): Promise<unknown>;
  set(value: ThemePreference): Promise<void>;
  subscribe(listener: (value: unknown) => void): () => void;
}

/** The adapter can access only the non-secret theme key, never credentials or session storage. */
export function createThemeStore(storage: ThemeStorage): ThemeStore {
  return {
    read: async () => themePreference(await storage.get()),
    write: async value => {
      if (value !== 'system' && value !== 'light' && value !== 'dark') throw new AppError('invalid_request');
      await storage.set(value);
    },
    subscribe: listener => storage.subscribe(value => listener(themePreference(value))),
  };
}
