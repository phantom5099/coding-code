export function createDebouncedStorage() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    getItem: (name: string): string | null => localStorage.getItem(name),
    setItem: (name: string, value: string): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(name, value);
        } catch (e) {
          console.error('Failed to persist state:', e);
        }
      }, 500);
    },
    removeItem: (name: string): void => {
      clearTimeout(timer);
      localStorage.removeItem(name);
    },
  };
}

export function normalizeCwd(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, l: string) => `${l.toLowerCase()}:`);
}
