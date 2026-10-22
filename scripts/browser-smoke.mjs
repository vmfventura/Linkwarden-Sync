#!/usr/bin/env node
// No dependencies, real credentials, production mutations, or retained profiles.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const selected = process.argv[2] ?? 'all';
const withUi = process.argv.includes('--ui');
if (!['all', 'chromium', 'firefox'].includes(selected)) throw new Error('Usage: node scripts/browser-smoke.mjs [all|chromium|firefox]');
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(100); }
  throw new Error(`Timed out: ${label}`);
}
async function port() {
  const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const value = server.address().port; await new Promise(r => server.close(r)); return value;
}
async function digest(dir) {
  const hash = createHash('sha256');
  async function visit(base, prefix = '') {
    for (const item of (await readdir(base, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${item.name}`;
      if (item.isDirectory()) await visit(join(base, item.name), `${name}/`);
      else { hash.update(name); hash.update(await readFile(join(base, item.name))); }
    }
  }
  await visit(dir); return hash.digest('hex');
}
class Rpc {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)); const request = this.pending.get(message.id);
      if (request) { this.pending.delete(message.id); clearTimeout(request.timer);
        if (message.error) request.reject(new Error(typeof message.error === 'string' ? `${message.error}: ${message.message}` : message.error.message));
        else request.resolve(message.result);
      }
    });
  }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once:true }); ws.addEventListener('error', () => rej(new Error('Debugger WebSocket connection failed')), { once:true }); });
    return new Rpc(ws);
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id; const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Debugger timeout: ${method}`)); }, 20000);
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.ws.close(); for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Debugger closed')); } this.pending.clear(); }
}
async function run(engine) {
  const binary = process.env[engine === 'chromium' ? 'CHROMIUM_BIN' : 'FIREFOX_BIN'] ?? `/usr/bin/${engine === 'chromium' ? 'chromium-browser' : 'firefox'}`;
  console.log(`${engine}: ${execFileSync(binary, ['--version'], { encoding:'utf8' }).trim()}`);
  const build = join(root, '.output', engine === 'chromium' ? 'chrome-mv3' : 'firefox-mv3');
  const before = await digest(build);
  const temp = await mkdtemp(join(tmpdir(), 'linkwarden-browser-smoke-'));
  const copy = join(temp, 'extension'); const profile = join(temp, 'profile');
  let child, rpc, evaluate, extensionUrl, context, demoChild; let log = ''; const checks = [];
  function pass(name) { checks.push(name); console.log(`  PASS ${name}`); }
  async function stop() {
    rpc?.close(); rpc = undefined;
    if (child && child.exitCode === null) {
      const done = new Promise(r => child.once('exit', r)); child.kill('SIGTERM');
      await Promise.race([done, pause(4000)]);
      if (child.exitCode === null) { child.kill('SIGKILL'); await done; }
    }
    child = undefined;
    if (demoChild && demoChild.exitCode === null) { const done = new Promise(r=>demoChild.once('exit', r)); demoChild.kill('SIGTERM'); await done; }
    demoChild = undefined;
  }
  const interrupt = async signal => {
    await stop(); await rm(temp, { recursive:true, force:true });
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  async function start() {
    const debugPort = await port();
    const args = engine === 'chromium' ? [
      '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
      `--disable-extensions-except=${copy}`, `--load-extension=${copy}`, 'about:blank',
    ] : ['--headless', '--no-remote', '--remote-allow-system-access', '--profile', profile, '--remote-debugging-port', String(debugPort), 'about:blank'];
    log = ''; child = spawn(binary, args, { stdio:['ignore','ignore','pipe'], env:{ ...process.env, MOZ_CRASHREPORTER_DISABLE:'1' } });
    child.stderr.on('data', b => { log = (log + b.toString()).slice(-12000); });
    child.on('error', () => {});
    const fetchJson = async path => {
      if (child.exitCode !== null) throw new Error(`Browser exited (${child.exitCode})`);
      try { const r = await fetch(`http://127.0.0.1:${debugPort}${path}`, { signal:AbortSignal.timeout(1000) }); return r.ok ? await r.json() : null; } catch { return null; }
    };
    if (engine === 'chromium') {
      const worker = await until(async () => (await fetchJson('/json/list'))?.find(t => t.type === 'service_worker' && t.url.endsWith('/background.js')), 'unpacked extension service worker');
      // URL.origin is null for extension schemes in Node.
      extensionUrl = worker.url.slice(0, worker.url.lastIndexOf('/') + 1);
      const page = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(extensionUrl + 'popup.html')}`, { method:'PUT' }).then(r=>r.json());
      rpc = await Rpc.open(page.webSocketDebuggerUrl);
      evaluate = async expression => {
        const result = await rpc.call('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
        if (result.exceptionDetails) throw new Error('Extension evaluation failed (details suppressed to avoid credential output)');
        return result.result.value;
      };
    } else {
      // Firefox's own WebDriver BiDi endpoint supports temporary add-on installation.
      await until(async () => {
        if (child.exitCode !== null) throw new Error(`Browser exited (${child.exitCode})`);
        try { const r = await fetch(`http://127.0.0.1:${debugPort}/`, { signal:AbortSignal.timeout(1000) }); return r.status > 0; } catch { return false; }
      }, 'Firefox remote agent');
      rpc = await Rpc.open(`ws://127.0.0.1:${debugPort}/session`);
      await rpc.call('session.new', { capabilities:{ alwaysMatch:{ acceptInsecureCerts:false } } });
      await rpc.call('webExtension.install', { extensionData:{ type:'path', path:copy } });
      context = (await rpc.call('browsingContext.create', { type:'tab' })).context;
      extensionUrl = 'moz-extension://8d3d5f48-318e-4b4b-861d-3c4e70e56349/';
      await rpc.call('browsingContext.navigate', { context, url:extensionUrl + 'popup.html', wait:'complete' });
      evaluate = async expression => {
        const result = await rpc.call('script.evaluate', { expression, target:{ context }, awaitPromise:true });
        if (result.type === 'exception') throw new Error('Extension evaluation failed (details suppressed to avoid credential output)');
        // Every test returns a JSON string; no credential objects cross the debugger boundary.
        return result.result.value;
      };
    }
    await until(async () => (await evaluate(`JSON.stringify({ready:!!document.querySelector('input[type="url"]') || !!document.querySelector('input[type="password"]')})`)).includes('true'), 'popup authentication form');
  }
  // Expressions return only booleans/sanitized labels; never storage or message payloads.
  async function check(name, body) {
    const result = JSON.parse(await evaluate(`(async()=>{const api=globalThis.browser??globalThis.chrome;
      const password='Smoke-only password 2026!';const token='synthetic-opaque-smoke-token-2026';const url='https://links.example.test';
      const request=async message=>{const r=await api.runtime.sendMessage(message);if(JSON.stringify(r)?.includes(token)||JSON.stringify(r)?.includes(password))throw Error('secret in response');return r;};
      let assertion=0;const ensure=(condition)=>{assertion++;if(!condition)throw Error('assertion');};
      try{${body};return JSON.stringify({pass:true});}catch{return JSON.stringify({pass:false,assertion,ui:document.querySelector('.demo-banner')?{folders:document.querySelectorAll('.folder-list button').length,scroll:document.querySelector('.library-scroll')?.scrollTop,focusedLast:document.activeElement?.matches('[data-folder-id=\"151\"]'),visibility:document.visibilityState}:null});}})()`));
    assert.equal(result.pass, true, `${name} (assertion ${result.assertion}; UI ${JSON.stringify(result.ui)})`); pass(name);
  }
  try {
    await cp(build, copy, { recursive:true });
    assert.equal(await digest(copy), before, 'Copied build must exactly match production');
    if (engine === 'firefox') {
      // Only disposable browser preferences; extension manifest and scripts remain exact.
      const { mkdir } = await import('node:fs/promises'); await mkdir(profile);
      const id = JSON.parse(await readFile(join(copy,'manifest.json'),'utf8')).browser_specific_settings.gecko.id;
      await writeFile(join(profile,'user.js'), [
        'user_pref("remote.active-protocols", 1);',
        `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({[id]:'8d3d5f48-318e-4b4b-861d-3c4e70e56349'}))});`,
        'user_pref("browser.shell.checkDefaultBrowser", false);',
      ].join('\n'));
    }
    console.log(`  build sha256 ${before}`);
    await start();
    pass('exact production build loaded; popup authentication form rendered');
    await check('setup placeholder, credential fields and native WebCrypto', `
      ensure(isSecureContext&&!!crypto.subtle);
      ensure(document.querySelector('input[type="url"]').placeholder==='https://links.example.com');
      ensure(document.querySelectorAll('input[type="password"]').length===3);
      ensure([...document.querySelectorAll('input[type="password"]')].every(e=>e.autocomplete==='off'));`);
    await check('setup through popup sender; state contains no token/password', `
      const r=await request({type:'setup',url,token,password});ensure(r.ok&&r.value.hasVault&&r.value.unlocked&&!r.value.connected);
      const state=await request({type:'state'});ensure(state.ok&&state.value.unlocked&&!('token' in state.value));`);
    await check('local ciphertext only; session has expected record and no password', `
      const local=await api.storage.local.get(null);ensure(Object.keys(local).join()==='credentialVault');
      const v=local.credentialVault;ensure(v.version===1&&v.kdf.name==='PBKDF2'&&v.kdf.iterations>=600000&&v.cipher.name==='AES-GCM'&&v.payload.ciphertext.length>16000&&!!v.wrap.ciphertext);
      ensure(!JSON.stringify(local).includes(token)&&!JSON.stringify(local).includes(password)&&!JSON.stringify(local).includes(url));
      const ram=await api.storage.session.get(null);ensure(Object.keys(ram).join()==='unlockedSession');
      ensure(Object.keys(ram.unlockedSession).sort().join()===['version','id','url','token','createdAt','expiresAt','absoluteExpiresAt','connected','lockMode'].sort().join());
      ensure(ram.unlockedSession.token===token&&!JSON.stringify(ram).includes(password));`);
    await check('lock clears session; wrong password rejected; correct password unlocks', `
      let r=await request({type:'lock'});ensure(r.ok&&!r.value.unlocked&&r.value.hasVault);ensure(Object.keys(await api.storage.session.get(null)).length===0);
      r=await request({type:'unlock',password:'Wrong smoke password!'});ensure(!r.ok&&r.error==='unlock_failed');
      ensure(!(await request({type:'state'})).value.unlocked);ensure(Object.keys(await api.storage.session.get(null)).length===0);
      r=await request({type:'unlock',password});ensure(r.ok&&r.value.unlocked);`);
    await check('expired RAM session rejected and removed (test-only timestamp tampering)', `
      const {unlockedSession:s}=await api.storage.session.get('unlockedSession');s.expiresAt=Date.now()-1;
      await api.storage.session.set({unlockedSession:s});const r=await request({type:'state'});ensure(r.ok&&!r.value.unlocked&&r.value.hasVault);
      ensure(Object.keys(await api.storage.session.get(null)).length===0);
      ensure((await request({type:'unlock',password})).value.unlocked);`);
    await check('security settings default, explicit browser-lifetime selection and safe restoration', `
      const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('settings UI timeout');};
      await wait(()=>[...document.querySelectorAll('footer button')].some(b=>b.textContent==='Security'));
      [...document.querySelectorAll('footer button')].find(b=>b.textContent==='Security').click();
      await wait(()=>!!document.querySelector('dialog select'));
      const select=document.querySelector('dialog select');ensure(select.value==='timeout');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'browser');
      select.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(()=>document.querySelector('dialog .warning')?.textContent.includes('Disables both timeout limits'));
      document.querySelector('dialog form').requestSubmit();
      await wait(()=>!document.querySelector('dialog'));
      let r=await request({type:'state'});ensure(r.ok&&r.value.unlocked&&r.value.lockMode==='browser'&&!('expiresAt' in r.value));
      let local=await api.storage.local.get(null);ensure(local.autoLockMode==='browser'&&Object.keys(local).length===2);
      ensure((await api.alarms.get('vaultExpiry')).periodInMinutes===5);
      const {unlockedSession:s}=await api.storage.session.get('unlockedSession');
      s.createdAt=Date.now()-2*24*60*60*1000;ensure(s.expiresAt===null&&s.absoluteExpiresAt===null);
      await api.storage.session.set({unlockedSession:s});
      r=await request({type:'activity'});ensure(r.ok&&r.value.unlocked&&!('expiresAt' in r.value));
      r=await request({type:'setLockMode',mode:'timeout'});ensure(r.ok&&r.value.lockMode==='timeout'&&r.value.expiresAt>Date.now());
      r=await request({type:'setLockMode',mode:'browser'});ensure(r.ok&&r.value.unlocked);
      await request({type:'lock'});r=await request({type:'setLockMode',mode:'timeout'});ensure(!r.ok&&r.error==='locked');
      r=await request({type:'unlock',password});ensure(r.ok&&r.value.lockMode==='browser'&&r.value.unlocked);`);
    await check('appearance: explicit themes work while locked and persist only a local enum', `
      const wait=async(fn)=>{for(let i=0;i<120;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('appearance UI timeout');};
      await request({type:'lock'});await wait(()=>!!document.querySelector('input[type="password"]'));
      document.querySelector('.header button[aria-label="Appearance"]').click();
      await wait(()=>!!document.querySelector('dialog[aria-label="Appearance"] select'));
      const select=document.querySelector('dialog[aria-label="Appearance"] select');ensure(select.value==='system');
      select.focus();
      for(const value of ['dark','light','system','dark']){
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,value);select.dispatchEvent(new Event('change',{bubbles:true}));
        await wait(()=>document.documentElement.dataset.theme===value&&select.getAttribute('aria-busy')==='false');
        ensure(document.activeElement===select);
        ensure((await api.storage.local.get('uiTheme')).uiTheme===value);
        ensure(!(await request({type:'state'})).value.unlocked);
        if(value!=='system')ensure(getComputedStyle(document.querySelector('.app')).backgroundColor===(value==='dark'?'rgb(38, 38, 38)':'rgb(243, 244, 246)'));
      }
      ensure(CSS.supports('color','light-dark(white,black)'));
      document.querySelector('dialog .dialog-title button').click();
      ensure((await request({type:'unlock',password})).value.unlocked);`);
    // Exact sender URL comparison must reject the otherwise trusted extension ID.
    if (engine === 'chromium') {
      await rpc.call('Page.navigate', { url:extensionUrl+'popup.html?untrusted-smoke' });
    } else await rpc.call('browsingContext.navigate', { context, url:extensionUrl+'popup.html?untrusted-smoke', wait:'complete' });
    await pause(500);
    await check('same extension ID with non-exact popup URL rejected', `
      let accepted=false;try{const r=await api.runtime.sendMessage({type:'forget'});accepted=r?.ok===true;}catch{}ensure(!accepted);`);
    if (engine === 'chromium') await rpc.call('Page.navigate', { url:extensionUrl+'popup.html' });
    else await rpc.call('browsingContext.navigate', { context, url:extensionUrl+'popup.html', wait:'complete' });
    await pause(500);
    await check('rejected sender did not forget vault', `ensure((await request({type:'state'})).value.hasVault);ensure((await request({type:'unlock',password})).value.unlocked);`);
    if (engine === 'chromium') await rpc.call('Page.navigate', { url:'data:text/html,<title>Untrusted smoke page</title>' });
    else await rpc.call('browsingContext.navigate', { context, url:'data:text/html,<title>Untrusted smoke page</title>', wait:'complete' });
    await pause(500);
    await check('ordinary web page has no extension messaging API', `
      ensure(!globalThis.browser?.runtime?.sendMessage&&!globalThis.chrome?.runtime?.sendMessage);`);
    if (engine === 'chromium') await rpc.call('Page.navigate', { url:extensionUrl+'library.html' });
    else await rpc.call('browsingContext.navigate', { context, url:extensionUrl+'library.html', wait:'complete' });
    await pause(500);
    await check('exact library sender accepted; unconnected UI stays at connection gate', `
      const r=await request({type:'state'});ensure(r.ok);ensure(r.value.hasVault);
      const unlocked=await request({type:'unlock',password});ensure(unlocked.ok&&unlocked.value.unlocked&&!unlocked.value.connected);
      for(let i=0;i<40&&!document.querySelector('output.server');i++)await new Promise(r=>setTimeout(r,50));
      ensure(!document.querySelector('.library'));ensure(!!document.querySelector('output.server'));`);
    await stop(); await start();
    await check('browser process restart locks session and retains encrypted vault', `
      const r=await request({type:'state'});ensure(r.ok&&r.value.hasVault&&!r.value.unlocked&&r.value.lockMode==='browser');ensure(Object.keys(await api.storage.session.get(null)).length===0);
      const unlocked=await request({type:'unlock',password});ensure(unlocked.value.unlocked&&unlocked.value.lockMode==='browser');
      ensure(document.documentElement.dataset.theme==='dark');ensure((await api.storage.local.get('uiTheme')).uiTheme==='dark');`);
    await check('forget removes vault and session', `
      const r=await request({type:'forget'});ensure(r.ok&&!r.value.hasVault&&!r.value.unlocked);
      ensure(Object.keys(await api.storage.local.get(null)).length===0&&Object.keys(await api.storage.session.get(null)).length===0);`);

    if (withUi) {
      await check('production credential forms: field clearing and wrong-password feedback', `
        const wait=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('UI timeout');};
        const fill=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
        await wait(()=>!!document.querySelector('input[type="url"]'));
        fill(document.querySelector('input[type="url"]'),url);
        const inputs=[...document.querySelectorAll('input[type="password"]')];fill(inputs[0],token);fill(inputs[1],password);fill(inputs[2],password);
        document.querySelector('form.auth').requestSubmit();
        await wait(()=>!!document.querySelector('output.server'));ensure(!document.querySelector('input[type="password"]'));
        await request({type:'lock'});await wait(()=>document.querySelectorAll('input[type="password"]').length===1);
        fill(document.querySelector('input[type="password"]'),'Wrong smoke password!');document.querySelector('form.auth').requestSubmit();
        await wait(()=>!!document.querySelector('[role="alert"]'));ensure(document.querySelector('input[type="password"]').value==='');
        ensure(!(await request({type:'state'})).value.unlocked);
        fill(document.querySelector('input[type="password"]'),password);document.querySelector('form.auth').requestSubmit();
        await wait(()=>!!document.querySelector('output.server'));ensure((await request({type:'state'})).value.unlocked);
        await request({type:'forget'});
      `);
      const demoPort = await port();
      demoChild = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--config', join(root, 'demo/vite.config.ts'), '--host', '127.0.0.1', '--port', String(demoPort), '--strictPort'], { cwd: root, stdio: 'ignore' });
      const demoUrl = `http://127.0.0.1:${demoPort}/popup.html`;
      await until(async () => { try { return (await fetch(demoUrl)).ok; } catch { return false; } }, 'synthetic UI server');
      if (engine === 'chromium') await rpc.call('Page.navigate', { url: demoUrl });
      else { await rpc.call('browsingContext.navigate', { context, url: demoUrl, wait: 'complete' }); await rpc.call('browsingContext.activate', { context }); }
      await until(async () => JSON.parse(await evaluate(`JSON.stringify(!!document.querySelector('.folder-list button'))`)), 'synthetic UI');
      await check('synthetic UI: 150 siblings scroll and last folder is keyboard reachable', `
        const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('UI timeout');};
        [...document.querySelectorAll('.folder-list button')].find(b=>b.textContent.includes('Synthetic library')).click();
        await wait(()=>document.querySelectorAll('.folder-list button').length===150&&!document.querySelector('.skeleton'));
        await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
        const scroll=document.querySelector('.library-scroll');const last=[...document.querySelectorAll('.folder-list button')].at(-1);
        ensure(scroll.scrollHeight>scroll.clientHeight&&getComputedStyle(scroll).overflowY==='auto');
        ensure(document.querySelector('.app').offsetWidth===440&&document.querySelector('.app').offsetHeight===600);
        last.focus();last.scrollIntoView({block:'center'});
        ensure(document.activeElement===last&&last.getBoundingClientRect().top>=scroll.getBoundingClientRect().top&&last.getBoundingClientRect().bottom<=scroll.getBoundingClientRect().bottom);
      `);
      // Use the engine's input protocol, rather than a JavaScript click, for last-item activation.
      if (engine === 'chromium') {
        await rpc.call('Page.bringToFront');
        await rpc.call('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13, text:'\r', unmodifiedText:'\r' });
        await rpc.call('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
      } else await rpc.call('input.performActions', { context, actions:[{ type:'key', id:'keyboard', actions:[{ type:'keyDown', value:'\uE007' },{ type:'keyUp', value:'\uE007' }] }] });
      await check('synthetic UI: navigation, parent focus, pagination, picker and locale', `
        const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('UI timeout');};
        await wait(()=>document.querySelector('.breadcrumbs').textContent.includes('Folder 150')&&document.querySelectorAll('.folder-list button').length===0);
        ensure(document.querySelectorAll('.folder-list button').length===0);
        [...document.querySelectorAll('.breadcrumbs button')].find(b=>b.textContent==='Synthetic library').click();
        await wait(()=>document.querySelectorAll('.folder-list button').length===150&&!document.querySelector('.skeleton'));
        await wait(()=>document.activeElement.textContent.includes('Folder 150')&&document.querySelector('.library-scroll').scrollTop>0);ensure(true);
        for(let i=0;i<5;i++){const count=document.querySelectorAll('.link-card').length;const more=document.querySelector('.load-more');ensure(!!more);more.click();await wait(()=>document.querySelectorAll('.link-card').length>count&&!document.querySelector('.skeleton'));}
        ensure(document.querySelectorAll('.link-card').length===120&&!document.querySelector('.load-more'));
        ensure([...document.querySelectorAll('.link-card a')].every(a=>a.target==='_blank'&&a.rel.includes('noopener')&&a.rel.includes('noreferrer')));
        document.querySelector('.header button[aria-label="Appearance"]').click();await wait(()=>!!document.querySelector('dialog select'));
        const theme=document.querySelector('dialog select');theme.value='dark';theme.dispatchEvent(new Event('change',{bubbles:true}));
        await wait(()=>document.documentElement.dataset.theme==='dark');document.querySelector('.dialog-title button').click();await wait(()=>!document.querySelector('dialog'));
        document.querySelector('.toolbar .primary').click();await wait(()=>!!document.querySelector('dialog[open]'));
        ensure(getComputedStyle(document.querySelector('dialog')).backgroundColor==='rgb(23, 23, 23)');
        ensure(getComputedStyle(document.querySelector('dialog .primary')).color==='rgb(0, 0, 0)');
        ensure(document.querySelector('dialog input[type="url"]').value==='https://example.com/synthetic-current-page');
        ensure([...document.querySelectorAll('dialog label')].find(l=>l.textContent==='Name').querySelector('input').value==='Synthetic current page');
        [...document.querySelectorAll('.picker-list button')].find(b=>b.textContent.includes('Synthetic library')).click();
        await wait(()=>document.querySelectorAll('.picker-list button').length===150);
        const picker=document.querySelector('.picker-list');const last=[...picker.querySelectorAll('button')].at(-1);last.focus();last.scrollIntoView({block:'center'});
        ensure(picker.scrollHeight>picker.clientHeight&&getComputedStyle(picker).overflowY==='auto'&&document.activeElement===last);
        last.click();await wait(()=>document.querySelectorAll('.picker-list button').length===0);
        [...document.querySelectorAll('.destination>button')].find(b=>b.textContent.includes('Use this collection')).click();
        await wait(()=>document.querySelector('.selected').textContent.includes('Folder 150'));ensure(true);
        document.querySelector('.dialog-title button').click();
        const select=document.querySelector('.header select');select.value='pt-PT';select.dispatchEvent(new Event('change',{bubbles:true}));
        await wait(()=>document.querySelector('.app').lang==='pt-PT');ensure(document.querySelector('.toolbar').textContent.includes('Adicionar ligação'));
        [...document.querySelectorAll('.header button')].find(b=>b.getAttribute('aria-label')==='Bloquear').click();
        await wait(()=>!document.querySelector('.library'));ensure(!document.querySelector('dialog[open]')&&localStorage.length===0&&sessionStorage.length===0);
      `);
    }
  } catch(error) {
    // Test bodies never embed evaluated exceptions, which might expose synthetic credentials.
    console.error(`  RESULT FAIL after ${checks.length} checks: ${error.message}`);
    const diagnostics = log.split('\n').filter(l=>/extension|DevTools|WebDriver|Remote|ERROR|Error/i.test(l)).slice(-6);
    for (const line of diagnostics) console.error(`  browser: ${line.replaceAll(temp,'<temporary-directory>')}`);
    process.exitCode = 1;
  } finally {
    await stop();
    await rm(temp, { recursive:true, force:true });
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    assert.equal(await digest(build), before, 'Production build changed during smoke run (possible concurrent rebuild)');
  }
  if (checks.length === (withUi ? 17 : 14)) console.log(`  RESULT PASS (${checks.length} checks; production hash unchanged; temporary profile removed)`);
}
for (const engine of selected === 'all' ? ['chromium','firefox'] : [selected]) await run(engine);
