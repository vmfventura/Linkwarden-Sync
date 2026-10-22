import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import { DemoBridge } from './fixtures';
import { detectLocale, en, pt } from '../src/ui/i18n';
import './style.css';
const bridge = new DemoBridge();
function Demo() {
  const [locale, setLocale] = useState(() => detectLocale(navigator.languages));
  const t = locale === 'pt-PT' ? pt : en;
  return <><aside className="demo-banner"><strong>{t.demo}</strong><button onClick={() => bridge.preview(false)}>{t.demoSetup}</button><button onClick={() => bridge.preview(true)}>{t.demoUnlocked}</button><select aria-label={t.language} value={locale} onChange={e => setLocale(e.target.value === 'pt-PT' ? 'pt-PT' : 'en')}><option value="en">EN</option><option value="pt-PT">PT</option></select></aside><div className="demo-app"><App bridge={bridge}/></div></>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Demo/></React.StrictMode>);
