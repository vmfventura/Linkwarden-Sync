import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../src/ui/App';
import { bridge } from '../../src/bridge';

// Apply the local appearance before rendering any credential or library view.
void bridge.appearance.read().catch(() => 'system' as const).then(theme => {
  document.documentElement.dataset.theme = theme;
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App bridge={bridge} initialTheme={theme}/></React.StrictMode>);
});
