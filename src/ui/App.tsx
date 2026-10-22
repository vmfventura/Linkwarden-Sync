import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Bridge, LockMode, VaultState } from '../core/protocol';
import type { Collection, Link, LinkInput } from '../core/models';
import { collectionPath, descendants, directChildren } from '../core/collections';
import { safeLinkUrl } from '../core/api';
import { AppError } from '../core/errors';
import { detectLocale, en, pt, messageError, type Catalogue, type Locale } from './i18n';
import type { ThemePreference } from '../core/theme';
import { useAppearance } from './useAppearance';
import { Icon } from './Icon';
import './style.css';

type Modal = { kind: 'link'; link: Link | null; page?: { url: string; name: string } } | { kind: 'folder'; folder: Collection | null } | { kind: 'delete'; link: Link };
const isPopup = () => typeof location !== 'undefined' && location.pathname.includes('popup');
export function App({ bridge, initialTheme = 'system' }: { bridge: Bridge; initialTheme?: ThemePreference }) {
  const appearance = useAppearance(bridge.appearance, initialTheme);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [locale, setLocale] = useState<Locale>(() => detectLocale(navigator.languages));
  const t = locale === 'pt-PT' ? pt : en;
  const [state, setState] = useState<VaultState | null>(null);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [forget, setForget] = useState(false);
  const [replace, setReplace] = useState(false);
  const [settings, setSettings] = useState(false);
  const epoch = useRef(0);
  const operation = useRef(0);
  const lastActivity = useRef(0);
  const reset = useCallback(() => {
    const current = ++epoch.current;
    setState(null); setGeneration(current); setError(null); setForget(false); setReplace(false); setSettings(false); setBusy(false);
    void bridge.request({ type: 'state' }).then(value => { if (epoch.current === current) setState(value); }, err => { if (epoch.current === current) setError(err); });
  }, [bridge]);
  useEffect(() => { reset(); const off = bridge.onSessionChange(reset); return () => { epoch.current++; off(); }; }, [bridge, reset]);
  const run = async (action: () => Promise<VaultState>) => {
    const current = epoch.current; const attempt = ++operation.current; setBusy(true); setError(null);
    try { const value = await action(); if (current === epoch.current) { setState(value); setReplace(false); setSettings(false); setForget(false); } }
    catch (err) { if (attempt === operation.current) setError(err); }
    finally { if (attempt === operation.current) setBusy(false); }
  };
  const lock = useCallback(() => { epoch.current++; setGeneration(epoch.current); setState(null); setReplace(false); setSettings(false); setForget(false); void bridge.request({ type: 'lock' }).then(reset, reset); }, [bridge, reset]);
  useEffect(() => {
    const hide = () => { epoch.current++; setGeneration(epoch.current); setState(null); setReplace(false); setSettings(false); setForget(false); };
    const visibility = () => { if (document.visibilityState === 'hidden') hide(); else reset(); };
    window.addEventListener('pagehide', hide); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('pagehide', hide); document.removeEventListener('visibilitychange', visibility); };
  }, [reset]);
  useEffect(() => {
    if (!state?.unlocked || state.lockMode === 'browser') return;
    const expires = state.expiresAt;
    const timer = expires === undefined ? undefined : setTimeout(reset, Math.max(0, expires - Date.now()));
    const activity = (event: Event) => {
      if (!event.isTrusted || Date.now() - lastActivity.current < 30_000 || document.visibilityState === 'hidden') return;
      lastActivity.current = Date.now(); const current = epoch.current;
      void bridge.request({ type: 'activity' }).then(value => { if (current === epoch.current) setState(value); }, () => {});
    };
    window.addEventListener('pointerdown', activity); window.addEventListener('keydown', activity);
    return () => { clearTimeout(timer); window.removeEventListener('pointerdown', activity); window.removeEventListener('keydown', activity); };
  }, [bridge, lock, reset, state]);
  return <div className={`app ${isPopup() ? 'popup' : 'full'}`} lang={locale}>
    <header className="header"><div className="brand"><span className="brand-mark"><Icon name="bookmark"/></span><div><strong>Linkwarden <span>Sync</span></strong><small>{t.subtitle}</small></div></div><div className="header-actions">
      <select aria-label={t.language} value={locale} onChange={e => setLocale(e.target.value as Locale)}><option value="en">EN</option><option value="pt-PT">PT</option></select>
      <button className="icon-button" title={t.appearance} aria-label={t.appearance} onClick={() => setAppearanceOpen(true)}><Icon name="appearance"/></button>
      <button className="icon-button" title={t.openLibrary} aria-label={t.openLibrary} onClick={() => bridge.openLibrary()}><Icon name="external"/></button>{state?.unlocked && <button className="icon-button" title={t.lock} aria-label={t.lock} onClick={lock}><Icon name="lock"/></button>}
    </div></header>
    {error != null && <div role="alert" className="error">{messageError(error, locale)}</div>}
    {!state ? <div className="auth"><Skeleton t={t}/>{error != null && <button onClick={reset}>{t.retry}</button>}</div> : !state.unlocked || !state.hasVault ? <Credentials key={generation} mode={state.hasVault ? 'unlock' : 'setup'} t={t} busy={busy} onSubmit={(url, token, password) => void run(() => state.hasVault ? bridge.request({ type: 'unlock', password }) : bridge.request({ type: 'setup', url, token, password }))}/> : !state.connected ? <section className="auth"><h1>{t.setup}</h1><p>{t.connectHint}</p><p>{t.permissionHint}</p><label>{t.server}<output className="server">{state.url}</output></label><button className="primary" disabled={busy || !state.url} onClick={() => { const url = state.url; const current = epoch.current; if (!url) return; void run(async () => { if (!await bridge.requestPermission(url)) throw new AppError('permission_required'); if (current !== epoch.current) throw new AppError('session_changed'); return bridge.request({ type: 'connect' }); }); }}>{busy ? t.loading : t.connect}</button><button onClick={() => setReplace(true)}>{t.replaceToken}</button></section> : <Library key={generation} bridge={bridge} t={t} locale={locale}/>}
    {state?.hasVault && <footer><span className="connection-summary" title={state.url}><Icon name="shield"/><span>{state.url ?? t.vaultLocked}</span></span>{state.unlocked && <button onClick={() => setSettings(true)}><Icon name="shield"/>{t.securitySettings}</button>}<button onClick={() => setReplace(true)} disabled={!state.unlocked} title={t.replaceToken} aria-label={t.replaceToken}><Icon name="key"/></button><button className="forget-action" onClick={() => setForget(true)} title={t.forget} aria-label={t.forget}><Icon name="trash"/></button></footer>}
    {appearanceOpen && <Dialog title={t.appearance} t={t} onClose={() => setAppearanceOpen(false)}><div className="editor"><label>{t.theme}<select value={appearance.preference} aria-busy={appearance.saving} onChange={event => void appearance.change(event.target.value as ThemePreference)}><option value="system">{t.themeSystem}</option><option value="light">{t.themeLight}</option><option value="dark">{t.themeDark}</option></select></label><p>{t.themeHint}</p>{appearance.failed && <p className="error" role="alert">{t.themeFailed}</p>}</div></Dialog>}
    {settings && state?.unlocked && <Dialog title={t.securitySettings} t={t} onClose={() => setSettings(false)}><LockSettings key={state.lockMode} mode={state.lockMode} t={t} busy={busy} onSave={mode => void run(() => bridge.request({ type: 'setLockMode', mode }))}/></Dialog>}
    {forget && <Dialog title={t.forget} t={t} onClose={() => setForget(false)}><p>{t.forgetConfirm}</p><button className="danger" disabled={busy} onClick={() => void run(() => bridge.request({ type: 'forget' }))}>{t.confirm}</button></Dialog>}
    {replace && <Dialog title={t.replaceToken} t={t} onClose={() => setReplace(false)}><Credentials mode="replace" t={t} busy={busy} onSubmit={(_url, token, password) => void run(() => bridge.request({ type: 'replaceToken', token, password }))}/></Dialog>}
  </div>;
}
function LockSettings({ mode, t, busy, onSave }: { mode: LockMode; t: Catalogue; busy: boolean; onSave: (mode: LockMode) => void }) {
  const [selected, setSelected] = useState(mode);
  return <form className="editor" onSubmit={event => { event.preventDefault(); onSave(selected); }}>
    <label>{t.automaticLock}<select value={selected} onChange={event => setSelected(event.target.value as LockMode)}>
      <option value="timeout">{t.lockTimeout}</option><option value="browser">{t.lockBrowser}</option>
    </select></label>
    <p>{t.lockTimeoutHint}</p>
    {selected === 'browser' && <p className="warning">{t.lockBrowserWarning}</p>}
    <p>{t.lockPreferenceHint}</p><button className="primary" disabled={busy}>{busy ? t.loading : t.save}</button>
  </form>;
}
function Skeleton({ t }: { t: Catalogue }) { return <div role="status" aria-label={t.loading} className="skeleton"><span/><span/><span/>{t.loading}</div>; }
function Credentials({ mode, t, busy, onSubmit }: { mode: 'setup' | 'unlock' | 'replace'; t: Catalogue; busy: boolean; onSubmit: (url: string, token: string, password: string) => void }) {
  const [url, setUrl] = useState(''); const [token, setToken] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [mismatch, setMismatch] = useState(false);
  return <form className="auth" onSubmit={e => { e.preventDefault(); if (mode === 'setup' && password !== confirm) { setMismatch(true); return; } const secret = password; const access = token; setPassword(''); setToken(''); setConfirm(''); setMismatch(false); onSubmit(url, access, secret); }}>
    <div className="vault-symbol" aria-hidden="true"><Icon name="lock"/></div><h1>{mode === 'setup' ? t.setup : mode === 'unlock' ? t.unlock : t.replaceToken}</h1><p>{mode === 'setup' ? t.setupHint : mode === 'unlock' ? t.unlockHint : t.replaceHint}</p>
    {mode === 'setup' && <label>{t.url}<input required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://links.example.com" autoComplete="off"/></label>}
    {mode !== 'unlock' && <label>{t.token}<input required type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" spellCheck={false}/></label>}
    <label>{t.password}<input required minLength={mode === 'setup' ? 12 : undefined} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off"/></label>
    {mode === 'setup' && <label>{t.confirmPassword}<input required minLength={12} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="off"/></label>}
    {mismatch && <p role="alert" className="error">{t.passwordMismatch}</p>}<button className="primary" disabled={busy}>{busy ? t.loading : mode === 'setup' ? t.saveVault : mode === 'unlock' ? t.unlockAction : t.save}</button>
  </form>;
}
function Dialog({ title, children, t, onClose }: { title: string; children: ReactNode; t: Catalogue; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); onClose(); }} aria-label={title}><div className="dialog-title"><h2>{title}</h2><button type="button" onClick={onClose} aria-label={t.close}><Icon name="close"/></button></div>{children}</dialog>;
}
function Destination({ folders, value, onChange, allowRoot, allowed, excluded, t }: { folders: Collection[]; value: number | null; onChange: (id: number | null) => void; allowRoot: boolean; allowed: (folder: Collection) => boolean; excluded: Set<number>; t: Catalogue }) {
  const [level, setLevel] = useState<number | null>(null);
  const current = folders.find(f => f.id === level);
  return <fieldset className="destination"><legend>{t.destination}</legend><div className="breadcrumbs"><button type="button" aria-current={level === null ? 'page' : undefined} onClick={() => setLevel(null)}>{t.root}</button>{collectionPath(folders, level).map(f => <button type="button" key={f.id} aria-current={level === f.id ? 'page' : undefined} onClick={() => setLevel(f.id)}>{f.name}</button>)}</div>
    <div className="picker-list">{directChildren(folders, level).filter(f => !excluded.has(f.id)).map(f => <button type="button" key={f.id} onClick={() => setLevel(f.id)}><Icon name="folder"/>{f.name} <span aria-hidden="true">›</span></button>)}{directChildren(folders, level).filter(f => !excluded.has(f.id)).length === 0 && <p>{t.noFolders}</p>}</div>
    <button type="button" disabled={level === null ? !allowRoot : !current || !allowed(current) || excluded.has(level)} onClick={() => onChange(level)}>{t.useDestination}: {current?.name ?? t.root}</button>
    <p className="selected">✓ {value === null ? (allowRoot ? t.root : t.selectCollection) : collectionPath(folders, value).map(f => f.name).join(' / ')}</p>{folders.find(f => f.id === value)?.shared && <p className="warning">{t.sharedWarning}</p>}
  </fieldset>;
}
function Library({ bridge, t, locale }: { bridge: Bridge; t: Catalogue; locale: Locale }) {
  const [folders, setFolders] = useState<Collection[]>([]); const [links, setLinks] = useState<Link[]>([]); const [folderId, setFolderId] = useState<number | null>(null);
  const [query, setQuery] = useState(''); const [draft, setDraft] = useState(''); const [cursor, setCursor] = useState<string | null>(null); const seen = useRef(new Set<string>());
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [saved, setSaved] = useState(false); const [revision, setRevision] = useState(0); const [modal, setModal] = useState<Modal | null>(null);
  const requestEpoch = useRef(0); const live = useRef(false); const loadingMore = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const returnFocus = useRef(new Map<number | null, number>());
  const restorePending = useRef(false);
  const [restoreVersion, setRestoreVersion] = useState(0);
  useEffect(() => { live.current = true; return () => { live.current = false; requestEpoch.current++; }; }, []);
  useEffect(() => {
    const epoch = ++requestEpoch.current; restorePending.current = true; setLinks([]); setCursor(null); seen.current.clear(); loadingMore.current = false; setBusy(false); setLoading(true); setError(null);
    void Promise.all([bridge.request({ type: 'collections' }), bridge.request({ type: 'search', collectionId: folderId, query, cursor: null })]).then(([collections, page]) => {
      if (!live.current || epoch !== requestEpoch.current) return;
      setFolders(collections); setLinks([...new Map(page.links.map(link => [link.id, link])).values()]); setCursor(page.nextCursor); setLoading(false); setRestoreVersion(value => value + 1);
    }, err => { if (live.current && epoch === requestEpoch.current) setError(err); }).finally(() => { if (live.current && epoch === requestEpoch.current) setLoading(false); });
  }, [bridge, folderId, query, revision]);
  useLayoutEffect(() => {
    if (loading || !scroll.current || !restorePending.current) return;
    restorePending.current = false;
    const focusId = returnFocus.current.get(folderId);
    if (focusId !== undefined) scroll.current.querySelector<HTMLButtonElement>(`[data-folder-id="${focusId}"]`)?.focus({ preventScroll: true });
    scroll.current.scrollTop = positions.current.get(`${folderId}:${query}`) ?? 0;
  }, [restoreVersion]);
  const loadMore = async () => {
    if (!cursor || loadingMore.current || seen.current.has(cursor)) return;
    const epoch = requestEpoch.current; const next = cursor; seen.current.add(next); loadingMore.current = true; setLoading(true);
    try { const page = await bridge.request({ type: 'search', collectionId: folderId, query, cursor: next }); if (!live.current || epoch !== requestEpoch.current) return;
      setLinks(old => [...new Map([...old, ...page.links].map(link => [link.id, link])).values()]);
      if (page.nextCursor && seen.current.has(page.nextCursor)) { setCursor(null); setError(new AppError('invalid_response')); } else setCursor(page.nextCursor);
    } catch (err) { if (live.current && epoch === requestEpoch.current) { seen.current.delete(next); setError(err); } }
    finally { if (live.current && epoch === requestEpoch.current) { loadingMore.current = false; setLoading(false); } }
  };
  const mutate = async (action: () => Promise<unknown>) => {
    const epoch = requestEpoch.current; setBusy(true); setError(null); setSaved(false);
    try { await action(); if (live.current && epoch === requestEpoch.current) { setModal(null); setSaved(true); setRevision(r => r + 1); } }
    catch (err) { if (live.current && epoch === requestEpoch.current) { setError(err); if (err instanceof AppError && err.code === 'conflict') setModal(null); } }
    finally { if (live.current && epoch === requestEpoch.current) setBusy(false); }
  };
  const capturing = useRef(false);
  const addCurrentPage = async () => {
    if (capturing.current || !isPopup()) return;
    const epoch = requestEpoch.current; capturing.current = true; setBusy(true); setError(null); setSaved(false);
    try {
      const page = await bridge.request({ type: 'currentPage' });
      if (live.current && epoch === requestEpoch.current) setModal({ kind: 'link', link: null, page });
    } catch (err) { if (live.current && epoch === requestEpoch.current) setError(err); }
    finally { capturing.current = false; if (live.current && epoch === requestEpoch.current) setBusy(false); }
  };
  const current = folders.find(f => f.id === folderId);
  const navigate = (id: number | null) => {
    if (id === folderId) return;
    positions.current.set(`${folderId}:${query}`, scroll.current?.scrollTop ?? 0);
    if (current?.parentId === id && folderId !== null) returnFocus.current.set(id, folderId);
    requestEpoch.current++; setLinks([]); setCursor(null); setModal(null); setFolderId(id); setSaved(false);
  };
  return <main className="library"><div className="library-top"><nav className="breadcrumbs" aria-label={t.folders}><button aria-current={folderId === null ? 'page' : undefined} onClick={() => navigate(null)}>{t.allLinks}</button>{collectionPath(folders, folderId).map(f => <button key={f.id} aria-current={folderId === f.id ? 'page' : undefined} onClick={() => navigate(f.id)}>{f.name}</button>)}</nav>
    <div className="view-heading"><div><p className="eyebrow">{t.library}</p><h1>{current?.name ?? t.allLinks}</h1></div><span className="view-symbol"><Icon name={current ? 'folder' : 'bookmark'}/></span></div>
    <form className="search" onSubmit={e => { e.preventDefault(); if (query !== draft) { requestEpoch.current++; setLinks([]); setCursor(null); } setQuery(draft); }}><span className="search-icon"><Icon name="search"/></span><input aria-label={t.search} placeholder={t.search} maxLength={500} value={draft} onChange={e => setDraft(e.target.value)}/><button>{t.searchAction}</button></form>
    <div className="toolbar"><button className="primary" disabled={busy || !isPopup() || !folders.some(f => f.canCreate)} title={!isPopup() ? t.captureFromPopup : undefined} onClick={() => void addCurrentPage()}><Icon name="plus"/>{t.newLink}</button><button disabled={current !== undefined && !(current.canCreate && current.canUpdate && current.canDelete)} onClick={() => setModal({ kind: 'folder', folder: null })}><Icon name="folder"/>{t.newFolder}</button>{current?.canManage && <button className="manage-folder" title={t.editFolder} aria-label={t.editFolder} onClick={() => setModal({ kind: 'folder', folder: current })}><Icon name="edit"/><span>{t.editFolder}</span></button>}</div>{!isPopup() && <p className="capture-hint">{t.captureFromPopup}</p>}</div>
    <div className="library-scroll" ref={scroll}><section><h2>{t.folders} <span className="count">{directChildren(folders, folderId).length}</span></h2><div className="folder-list">{directChildren(folders, folderId).map(f => <button key={f.id} data-folder-id={f.id} onClick={() => navigate(f.id)}><span className="folder-glyph"><Icon name="folder"/></span><span>{f.name}<small>{f.shared ? t.shared : !f.canCreate && !f.canUpdate ? t.readonly : ''}</small></span><span className="folder-meta"><span className="count" aria-hidden="true">{f.linkCount ?? ''}</span>{f.linkCount !== undefined && <span className="sr-only">{t.links}: {f.linkCount}</span>}<span className="folder-chevron" aria-hidden="true">›</span></span></button>)}</div></section>
    <section className="links-section"><h2>{t.links} <span className="count">{links.length}</span></h2>{links.map(link => { const permissions = folders.find(f => f.id === link.collectionId); const unsupported = !link.url || link.url !== link.url.trim() || link.name.length > 2048 || link.description.length > 2048 || link.tags.length > 50; let href: string | undefined; try { href = safeLinkUrl(link.url); } catch { /* Non-web attachments have no navigation target. */ }
      return <article className="link-card" key={link.id}><div className="link-symbol" aria-hidden="true"><Icon name="link"/></div><div className="link-content">{href ? <a href={href} target="_blank" rel="noopener noreferrer">{link.name || link.url}</a> : <strong>{link.name}</strong>}<p className="link-url">{link.url || t.attachment}</p>{link.description && <p>{link.description}</p>}<div className="tags">{link.tags.map((tag, i) => <span key={`${i}:${tag}`}>{tag}</span>)}</div><div className="card-actions"><button disabled={!permissions?.canUpdate || unsupported} title={unsupported ? messageError(new AppError('unsupported_edit'), locale) : undefined} onClick={() => setModal({ kind: 'link', link })}><Icon name="edit"/>{t.edit}</button><button disabled={!permissions?.canDelete} onClick={() => setModal({ kind: 'delete', link })}><Icon name="trash"/>{t.delete}</button></div></div></article>;
    })}{loading && <Skeleton t={t}/>} {!loading && links.length === 0 && <div className="empty"><Icon name="bookmark"/><p>{t.noLinks}</p></div>}{cursor && <button disabled={loading} className="load-more" onClick={() => void loadMore()}>{t.loadMore}</button>}</section></div>
    {error != null && <div role="alert" className="error">{messageError(error, locale)} <button disabled={busy} onClick={() => setRevision(r => r + 1)}>{t.retry}</button></div>}{saved && <p role="status" className="success">{t.success}</p>}
    {modal && <Dialog title={modal.kind === 'link' ? modal.link ? t.editLink : t.newLink : modal.kind === 'folder' ? modal.folder ? t.editFolder : t.newFolder : t.delete} t={t} onClose={() => { if (!busy) setModal(null); }}>
      {modal.kind === 'delete' ? <><p>{t.deleteConfirm}</p><p>{modal.link.name}</p><button className="danger" disabled={busy} onClick={() => void mutate(() => bridge.request({ type: 'deleteLink', id: modal.link.id }))}>{t.confirm}</button></> : modal.kind === 'link' ? <LinkEditor page={modal.page} folders={folders} link={modal.link} initialFolder={folderId} t={t} busy={busy} locale={locale} onSubmit={input => void mutate(() => modal.link ? bridge.request({ type: 'updateLink', id: modal.link.id, input, original: { url: modal.link.url, name: modal.link.name, description: modal.link.description, tags: modal.link.tags, collectionId: modal.link.collectionId } }) : bridge.request({ type: 'createLink', input }))}/> : <FolderEditor folders={folders} folder={modal.folder} initialFolder={folderId} t={t} busy={busy} onSubmit={(name, parentId) => void mutate(() => modal.folder ? bridge.request({ type: 'updateCollection', id: modal.folder.id, input: { name, parentId } }) : bridge.request({ type: 'createCollection', input: { name, parentId } }))}/>}
      {error != null && <p role="alert" className="error">{messageError(error, locale)}</p>}
    </Dialog>}
  </main>;
}
function LinkEditor({ page, folders, link, initialFolder, t, busy, locale, onSubmit }: { page: { url: string; name: string } | undefined; folders: Collection[]; link: Link | null; initialFolder: number | null; t: Catalogue; busy: boolean; locale: Locale; onSubmit: (input: LinkInput) => void }) {
  const [url, setUrl] = useState(link?.url ?? page?.url ?? ''); const [name, setName] = useState(link?.name ?? page?.name ?? ''); const [description, setDescription] = useState(link?.description ?? ''); const [tags, setTags] = useState<string[]>(link?.tags ?? []); const [tagDraft, setTagDraft] = useState(''); const [destination, setDestination] = useState<number | null>(link?.collectionId ?? initialFolder); const [error, setError] = useState<unknown>(null);
  const source = folders.find(f => f.id === link?.collectionId);
  const allowed = (f: Collection) => link ? f.id === link.collectionId ? !!source?.canUpdate : !!source?.canManage && f.canManage : f.canCreate;
  return <form className="editor" onSubmit={(e: FormEvent) => { e.preventDefault(); if (destination === null || !folders.some(f => f.id === destination && allowed(f))) { setError(new AppError('invalid_destination')); return; } try { if (!link || url !== link.url) safeLinkUrl(url); } catch (err) { setError(err); return; } onSubmit({ url, name, description, collectionId: destination, tags: [...tags, ...(tagDraft.trim() ? [tagDraft.trim()] : [])] }); }}>

    <label>{t.linkUrl}<input required type="url" value={url} onChange={e => setUrl(e.target.value)} maxLength={2048}/></label><label>{t.name}<input maxLength={2048} value={name} onChange={e => setName(e.target.value)}/></label><label>{t.description}<textarea maxLength={2048} value={description} onChange={e => setDescription(e.target.value)}/></label><label>{t.tags}<input maxLength={50} value={tagDraft} onChange={e => setTagDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (tagDraft.trim()) { setTags(old => [...new Set([...old, tagDraft.trim()])]); setTagDraft(''); } } }}/></label><button type="button" onClick={() => { if (tagDraft.trim()) { setTags(old => [...new Set([...old, tagDraft.trim()])]); setTagDraft(''); } }}>{t.addTag}</button><div className="tags">{tags.map((tag, index) => <button type="button" key={`${index}:${tag}`} aria-label={`${t.removeTag}: ${tag}`} onClick={() => setTags(old => old.filter((_, i) => i !== index))}>{tag} ×</button>)}</div>
    <Destination folders={folders} value={destination} onChange={setDestination} allowRoot={false} allowed={allowed} excluded={new Set()} t={t}/><p className="warning">{t.archiveWarning}</p>{link && url !== link.url && <p className="warning">{t.urlChangeWarning}</p>}{error != null && <p role="alert" className="error">{messageError(error, locale)}</p>}<button className="primary" disabled={busy || destination === null}>{busy ? t.loading : t.save}</button>
  </form>;
}
function FolderEditor({ folders, folder, initialFolder, t, busy, onSubmit }: { folders: Collection[]; folder: Collection | null; initialFolder: number | null; t: Catalogue; busy: boolean; onSubmit: (name: string, parentId: number | null) => void }) {
  const [name, setName] = useState(folder?.name ?? ''); const [destination, setDestination] = useState<number | null>(folder ? folder.parentId : initialFolder);
  const excluded = folder ? descendants(folders, folder.id) : new Set<number>();
  const allowed = (f: Collection) => folder ? f.canManage : f.canCreate && f.canUpdate && f.canDelete;
  return <form className="editor" onSubmit={e => { e.preventDefault(); if (destination !== null && (excluded.has(destination) || !folders.some(f => f.id === destination && allowed(f)))) return; onSubmit(name, destination); }}><label>{t.name}<input required maxLength={2048} value={name} onChange={e => setName(e.target.value)}/></label><Destination folders={folders} value={destination} onChange={setDestination} allowRoot allowed={allowed} excluded={excluded} t={t}/><button className="primary" disabled={busy || !name.trim()}>{busy ? t.loading : t.save}</button></form>;
}
