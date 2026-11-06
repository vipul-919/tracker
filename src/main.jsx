import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, ChartNoAxesCombined, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Copy, Ellipsis, ExternalLink, Eye, Globe2, KeyRound, LayoutDashboard, LogOut, Menu, Moon, Pencil, Plus, Search, Settings2, ShieldCheck, Sun, Trash2, Users, X } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar, Cell } from 'recharts';
import { api, download } from './api';
import { categories, dateKey, duration, monthKey, monthlyStats, reportRows } from '../shared/tracking';
import './styles.css';

const NAV = [['Dashboard', LayoutDashboard], ['My Websites', Globe2], ['Calendar', CalendarDays], ['Work Logs', Clock3], ['Reports', ChartNoAxesCombined], ['User Management', Users], ['Settings', Settings2]];
const COLORS = ['#587859', '#ad8c68', '#8486a7', '#789ca2', '#bd887e', '#8d9e6b', '#6888ac'];
const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2026, i).toLocaleString('en', { month: 'long' }));
function prettyDate(v, options = {}) { return new Date(v + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric', ...options }); }
function SiteIcon({ website, index = 0 }) { return <span className="site-icon" style={{ '--site-color': COLORS[index % COLORS.length] }}>{website?.name?.slice(0, 1).toUpperCase() || 'W'}</span>; }
function Empty({ icon: Icon = Globe2, title, text, action, onAction }) { return <div className="empty"><Icon size={30}/><h3>{title}</h3><p>{text}</p>{action && <button className="button primary" onClick={onAction}><Plus size={16}/>{action}</button>}</div>; }
function App() {
  const [user, setUser] = useState(null), [boot, setBoot] = useState(true), [authError, setAuthError] = useState('');
  const [data, setData] = useState({ websites: [], logs: [], allocations: [] });
  const [page, setPage] = useState('Dashboard'), [month, setMonth] = useState(dateKey().slice(0, 7));
  const [theme, setTheme] = useState(localStorage.getItem('tempo-theme') || 'light'), [sidebar, setSidebar] = useState(false);
  const [modal, setModal] = useState(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState('');
  const [search, setSearch] = useState('');
  const [year, monthNumber] = month.split('-').map(Number);
  const canEdit = user?.role === 'admin' || user?.role === 'editor';
  const isPrimaryAdmin = Boolean(user?.isPrimaryAdmin);
  const navItems = useMemo(() => NAV.filter(([label]) => label !== 'User Management' || isPrimaryAdmin).filter(([label]) => label !== 'Settings' || isPrimaryAdmin), [isPrimaryAdmin]);
  const refresh = async () => { setLoading(true); try { setData(await api('/data')); setError(''); } catch (e) { setError(e.message); if (e.status === 401) setUser(null); } finally { setLoading(false); } };
  useEffect(() => { api('/auth/me').then(u => { setUser(u); }).catch(e => { if (e.status !== 401) setAuthError(e.message); }).finally(() => setBoot(false)); }, []);
  useEffect(() => { if (user) refresh(); }, [user]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('tempo-theme', theme); }, [theme]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 4000); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => { const onDownloadError = event => setExportError(event.detail); window.addEventListener('tempo-download-error', onDownloadError); return () => window.removeEventListener('tempo-download-error', onDownloadError); }, []);
  useEffect(() => { if (user && !navItems.some(([label]) => label === page)) setPage('Dashboard'); }, [user, navItems, page]);
  const stats = useMemo(() => monthlyStats(data.websites, data.logs, data.allocations, year, monthNumber), [data, year, monthNumber]);
  const notify = (s) => setToast(s);
  const mutate = async (path, method, body, message) => { setBusy(true); try { await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }); await refresh(); setModal(null); notify(message); } finally { setBusy(false); } };
  const exportFile = async (path, label) => { setExportError(''); setExporting(true); try { if (await download(path)) notify(`${label} downloaded`); } catch (e) { setExportError(e.message || 'The export could not be downloaded. Please try again.'); } finally { setExporting(false); } };
  const openLog = (date = dateKey(), log = null) => { if (!data.websites.length) { setModal({ type: 'website' }); notify('Add your first website to start tracking.'); } else setModal({ type: 'log', date, value: log }); };
  const changePage = (p) => { setPage(p); setSearch(''); setSidebar(false); };
  const remove = (kind, value) => setModal({ type: 'delete', kind, value });
  const duplicate = l => { const { websiteId, date, description, category, hours, minutes, notes } = l; mutate('/logs', 'POST', { websiteId, date, description, category, hours, minutes, notes }, 'Work log duplicated').catch(e => setError(e.message)); };
  if (boot) return <div className="boot"><span className="brand-mark">t</span><p>Opening your workspace…</p></div>;
  if (!user) return <Auth onAuth={setUser} initialError={authError}/>;
  if (user.mustChangePassword) return <PasswordChange onComplete={setUser}/>;
  return <div className="app-shell">
    {sidebar && <div className="sidebar-shade" onClick={() => setSidebar(false)}/>}
    <aside className={`sidebar ${sidebar ? 'is-open' : ''}`}>
      <a className="brand" href="#dashboard" onClick={() => changePage('Dashboard')}><span className="brand-mark">t<span>•</span></span>tempo<span className="brand-dot">®</span></a>
      <div className="workspace-label"><span className="workspace-avatar">{user.name[0].toUpperCase()}</span><div><strong>My workspace</strong><small>Website hours tracker</small></div><ChevronDown size={14}/></div>
      <div className="nav-label">WORKSPACE</div>
        <nav>{navItems.map(([label, Icon]) => <button key={label} className={`nav-item ${page === label ? 'active' : ''} ${label === 'Settings' ? 'settings-nav' : ''}`} onClick={() => changePage(label)}><Icon size={18}/><span>{label}</span>{label === 'My Websites' && <span className="nav-count">{data.websites.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="note-icon"><Activity size={18}/></span><strong>A little progress, every day.</strong><p>Make time for the work<br/>that makes a difference.</p></div><button className="help-link" onClick={() => setModal({ type: 'help' })}><CircleHelp size={17}/> Help & getting started <ArrowUpRight size={14}/></button><div className="profile"><span className="user-avatar">{user.name[0].toUpperCase()}</span><div><strong>{user.name}</strong><small>Personal workspace</small></div><button className="icon-button" title="Sign out" onClick={async () => { try { await api('/auth/logout', { method: 'POST' }); setUser(null); setData({ websites: [], logs: [], allocations: [] }); } catch(e) { setError(e.message); } }}><LogOut size={16}/></button></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setSidebar(true)}><Menu size={20}/></button><span>Workspace</span><ChevronRight size={13}/><strong>{page}</strong></div><div className="topbar-actions"><span className="local-date">{new Date().toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span><span className="topbar-divider"/><button className="icon-button" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={18}/> : <Sun size={18}/>}</button><span className="mini-avatar">{user.name[0].toUpperCase()}</span></div></header>
    <main className={canEdit ? '' : 'read-only'}>
        <div className="page-heading"><div><div className="eyebrow">YOUR TIME, WELL SPENT</div><h1>{page === 'Dashboard' ? 'A clear view of your work.' : page}</h1><p>{({ Dashboard: 'Every website. Every hour. All moving forward.', 'My Websites': 'A home for every website you look after.', Calendar: 'See the rhythm of your work, one day at a time.', 'Work Logs': 'The small steps behind your bigger progress.', Reports: 'Turn your working hours into a clearer picture.', 'User Management': 'Manage workspace access and review important activity.', Settings: 'Make this workspace feel like yours.' })[page]}</p></div><div className="heading-actions">{!['Settings', 'User Management'].includes(page) && <label className="month-picker"><CalendarDays size={16}/><input aria-label="Selected month" type="month" min="1900-01" max="2200-12" value={month} onChange={e => e.target.value && setMonth(e.target.value)}/></label>}{canEdit && page !== 'User Management' && <button className="button primary" onClick={() => page === 'My Websites' ? setModal({ type: 'website' }) : openLog()}><Plus size={17}/>{page === 'My Websites' ? 'Add website' : 'Log work'}</button>}</div></div>
      {error && <div className="alert error">{error}<button onClick={refresh}>Try again</button><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
      {exportError && <div className="alert error" role="alert">{exportError}<button className="icon-button" aria-label="Dismiss export error" onClick={() => setExportError('')}><X size={16}/></button></div>}
      {loading && <div className="loading-line" role="status">Syncing your workspace…</div>}
      {page === 'Dashboard' && <Dashboard data={data} stats={stats} month={month} user={user} onNavigate={changePage} onLog={canEdit ? openLog : () => {}} onTarget={canEdit ? w => setModal({ type: 'target', value: w }) : () => {}}/>}
      {page === 'My Websites' && <Websites
        {...{ data, stats, search, setSearch, exporting, canEdit }}
        onAdd={canEdit ? () => setModal({ type: 'website' }) : undefined}
        onEdit={canEdit ? w => setModal({ type: 'website', value: w }) : undefined}
        onDelete={canEdit ? w => remove('websites', w) : undefined}
        onTarget={canEdit ? w => setModal({ type: 'target', value: w }) : undefined}
        onExport={(w, format) => exportFile(`/websites/${encodeURIComponent(w.id)}/export/${format}`, `${w.name} report`)}
        onExportAll={format => exportFile(`/export/all/${format}`, 'All projects report')}
        onToggle={canEdit ? w => { const { name, url, description, defaultMonthlyHours, startDate } = w; mutate(`/websites/${w.id}`, 'PUT', { name, url, description, defaultMonthlyHours, startDate, status: w.status === 'Active' ? 'Inactive' : 'Active' }, 'Website status updated').catch(e => setError(e.message)); } : undefined}
      />}
      {page === 'Calendar' && <Calendar {...{ data, year, monthNumber, setMonth }} onDay={date => setModal({ type: 'day', date })}/>}
      {page === 'Work Logs' && <Logs {...{ data, month, search, setSearch }} onAdd={canEdit ? () => openLog() : undefined} onEdit={canEdit ? l => openLog(l.date, l) : undefined} onDelete={canEdit ? l => remove('logs', l) : undefined} onDuplicate={canEdit ? duplicate : undefined}/>}
      {page === 'Reports' && <Reports {...{ data, month }}/>} 
      {page === 'User Management' && isPrimaryAdmin && <UserManagement/>}
      {page === 'Settings' && isPrimaryAdmin && <Settings {...{ user, theme, setTheme }} onHelp={() => setModal({ type: 'help' })}/>}
      <footer><span><span className="status-dot"/> A little more clarity. A little more progress.</span><span>Made for meaningful work.</span></footer>
    </main></div>
    {toast && <div className="toast" role="status"><Check size={17}/>{toast}</div>}
    {modal && <Modal title={{ website: modal.value ? 'Edit website' : 'Add a website', log: modal.value ? 'Edit work log' : 'Log your work', target: 'Set monthly target', delete: 'Delete this record?', day: prettyDate(modal.date || dateKey(), { weekday: 'long', year: 'numeric' }), help: 'Welcome to Tempo' }[modal.type]} onClose={() => !busy && setModal(null)}>
      {modal.type === 'website' && <WebsiteForm value={modal.value} busy={busy} onSave={v => mutate(`/websites${modal.value ? '/' + modal.value.id : ''}`, modal.value ? 'PUT' : 'POST', v, 'Website saved')}/>}
      {modal.type === 'log' && <LogForm {...{ data, busy }} date={modal.date} value={modal.value} onSave={v => mutate(`/logs${modal.value ? '/' + modal.value.id : ''}`, modal.value ? 'PUT' : 'POST', v, 'Work log saved')}/>}
      {modal.type === 'target' && <TargetForm {...{ month, data, busy }} website={modal.value} onSave={v => mutate('/allocations', 'PUT', v, 'Monthly target saved')} onReset={allocation => mutate(`/allocations/${allocation.id}`, 'DELETE', null, 'Default target restored')}/>}
      {modal.type === 'delete' && <DeleteForm busy={busy} text={modal.kind === 'websites' ? `Deleting ${modal.value.name} also permanently deletes its work logs and monthly targets.` : 'This work log will be permanently deleted and your totals will update.'} onConfirm={() => mutate(`/${modal.kind}/${modal.value.id}`, 'DELETE', null, 'Record deleted')}/>}
      {modal.type === 'day' && <div className="day-details"><p className="muted">{duration(data.logs.filter(l => l.date === modal.date).reduce((n, l) => n + l.totalMinutes, 0))} logged on this day</p>{data.logs.filter(l => l.date === modal.date).map(l => <div className="day-entry" key={l.id}><div><strong>{data.websites.find(w => w.id === l.websiteId)?.name}</strong><p>{l.description}</p><small>{l.category} · {duration(l.totalMinutes)}</small></div>{canEdit && <button className="icon-button" aria-label="Edit entry" onClick={() => openLog(l.date, l)}><Pencil size={16}/></button>}{canEdit && <button className="icon-button danger-text" aria-label="Delete entry" onClick={() => remove('logs', l)}><Trash2 size={16}/></button>}</div>)}{canEdit && <button className="button primary full-width" onClick={() => openLog(modal.date)}><Plus size={16}/>Add work entry</button>}</div>}
      {modal.type === 'help' && <div className="help-content"><p>Tempo brings the time you spend on your websites into one calm workspace.</p><ol><li><strong>Add your websites</strong><p>Set a start date and default monthly allocation for each project.</p></li><li><strong>Make time visible</strong><p>Log work from any calendar day. Use hours and minutes, categories, and notes.</p></li><li><strong>Keep an eye on progress</strong><p>Choose a month to compare your work with your targets. Set individual monthly overrides from My Websites.</p></li><li><strong>Take your data with you</strong><p>Export filtered reports to CSV or Excel, or download a complete JSON backup in Settings.</p></li></ol></div>}
    </Modal>}
  </div>;
}

function Auth({ onAuth, initialError }) {
  const [mode, setMode] = useState('login'), [error, setError] = useState(initialError), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [setup, setSetup] = useState(null);
  useEffect(() => { api('/auth/setup-status').then(setSetup).catch(() => setSetup(null)); }, []);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    const form = new FormData(e.currentTarget), email = form.get('email');
    try {
      if (mode === 'login') onAuth(await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: form.get('password') }) }));
      else if (mode === 'forgot') { await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }); setNotice('If an active account matches that email, a recovery code will be sent.'); setMode('reset'); }
      else if (mode === 'reset') {
        if (form.get('password') !== form.get('confirmPassword')) throw new Error('Passwords do not match.');
        await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, code: form.get('code'), password: form.get('password') }) });
        setNotice('Password updated. Sign in with your new password.'); setMode('login');
      } else {
        if (form.get('password') !== form.get('confirmPassword')) throw new Error('Passwords do not match.');
        const user = await api('/auth/bootstrap', { method: 'POST', headers: { 'X-Admin-Bootstrap-Token': form.get('bootstrapToken') }, body: JSON.stringify({ name: form.get('name'), email, password: form.get('password') }) });
        setSetup({ needsOwner: false, bootstrapEnabled: false }); onAuth(user);
      }
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  const isBootstrap = mode === 'bootstrap', isReset = mode === 'reset';
  return <div className="auth-layout"><div className="auth-story"><a className="brand"><span className="brand-mark">t<span>•</span></span>tempo</a><div><span className="eyebrow">A LITTLE PROGRESS, EVERY DAY</span><h1>Good work<br/>deserves<br/><em>a little clarity.</em></h1><p>One considered workspace for your websites,<br/>your hours, and everything moving forward.</p><div className="auth-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-clock"><Clock3 size={65} strokeWidth={1}/></div><span className="art-label"><span className="status-dot"/> Time, well spent.</span></div></div><small>WEBSITE WORK HOURS TRACKER</small></div><div className="auth-form-wrap"><form className="auth-form" onSubmit={submit}><span className="eyebrow">{isBootstrap ? 'SECURE OWNER SETUP' : 'YOUR PERSONAL WORKSPACE'}</span><h2>{isBootstrap ? 'Set up the owner.' : isReset ? 'Reset your password.' : mode === 'forgot' ? 'Recover your account.' : 'Welcome back.'}</h2><p>{isBootstrap ? 'Use the one-time setup token configured by the server.' : isReset ? 'Enter the code from your email and choose a new password.' : mode === 'forgot' ? 'We’ll email a short-lived recovery code if the account is active.' : 'Sign in to your workspace.'}</p>{error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert" role="status">{notice}</div>}{isBootstrap && <><label>Full name<input name="name" autoComplete="name" maxLength={100} required placeholder="Alex Morgan"/></label><label>One-time setup token<input name="bootstrapToken" type="password" autoComplete="off" required/></label></>}<label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com"/></label>{isReset && <><label>Recovery code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} required/></label><label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required placeholder="At least 12 characters"/></label><label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label></>}{(mode === 'login' || isBootstrap) && <label>{isBootstrap ? 'Password' : 'Password'}<input name="password" type="password" autoComplete={isBootstrap ? 'new-password' : 'current-password'} minLength={isBootstrap ? 12 : 10} maxLength={128} required placeholder={isBootstrap ? 'At least 12 characters' : 'Your password'}/></label>}{isBootstrap && <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label>}<button className="button primary full-width" disabled={busy}>{busy ? 'Please wait…' : isBootstrap ? 'Create primary Admin' : isReset ? 'Update password' : mode === 'forgot' ? 'Send recovery code' : 'Sign in'}<ArrowRight size={17}/></button>{mode === 'login' && <button className="text-button auth-secondary-action" type="button" onClick={() => { setMode('forgot'); setError(''); setNotice(''); }}>Forgot Password?</button>}{mode !== 'login' && !isBootstrap && <button className="text-button auth-secondary-action" type="button" onClick={() => { setMode('login'); setError(''); setNotice(''); }}>Back to sign in</button>}{setup?.needsOwner && setup.bootstrapEnabled && mode === 'login' && <button className="text-button auth-secondary-action" type="button" onClick={() => { setMode('bootstrap'); setError(''); setNotice(''); }}>Set up primary Admin</button>}{setup?.needsOwner && !setup.bootstrapEnabled && mode === 'login' && <p className="auth-footnote">Owner setup is not enabled. Configure ADMIN_BOOTSTRAP_TOKEN on the server.</p>}<div className="auth-footnote"><Check size={14}/> Your work. Your data. Your workspace.</div></form></div></div>;
}

function PasswordChange({ onComplete }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError(''); const form = new FormData(event.currentTarget);
    if (form.get('password') !== form.get('confirmPassword')) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try { onComplete(await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ newPassword: form.get('password') }) })); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  return <div className="auth-layout"><div className="auth-story"><a className="brand"><span className="brand-mark">t<span>•</span></span>tempo</a><div><span className="eyebrow">ACCOUNT SECURITY</span><h1>One quick<br/>change before<br/><em>you begin.</em></h1><p>Your temporary password must be replaced before accessing workspace data.</p></div><small>WEBSITE WORK HOURS TRACKER</small></div><div className="auth-form-wrap"><form className="auth-form" onSubmit={submit}><span className="eyebrow">FIRST SIGN IN</span><h2>Choose a new password.</h2><p>Use at least 12 characters.</p>{error && <div className="alert error" role="alert">{error}</div>}<label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label><label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label><button className="button primary full-width" disabled={busy}>{busy ? 'Updating…' : 'Update password'}<Check size={16}/></button></form></div></div>;
}

function Dashboard({ data, stats, month, onNavigate, onLog, onTarget }) {
  const [year, m] = month.split('-').map(Number);
  const activeIds = new Set(stats.rows.map(w => w.id));
  const logs = data.logs.filter(l => l.date.startsWith(month) && activeIds.has(l.websiteId));
  const days = new Date(year, m, 0).getDate();
  const trend = Array.from({ length: days }, (_, i) => { const key = `${month}-${String(i + 1).padStart(2, '0')}`; return { day: i + 1, worked: +(logs.filter(l => l.date <= key).reduce((s, l) => s + l.totalMinutes, 0) / 60).toFixed(2), target: +(stats.allocated / 60 * (i + 1) / days).toFixed(2) }; });
  const exceeded = stats.rows.filter(w => w.extra > 0), behind = stats.rows.filter(w => w.actual < w.allocated);
  const metrics = [ ['Active websites', stats.rows.length, Globe2, 'Your digital portfolio'], ['Monthly allocation', duration(stats.allocated), CalendarDays, 'Time set aside for good work'], ['Hours worked', duration(stats.actual), Clock3, `${logs.length} work ${logs.length === 1 ? 'entry' : 'entries'} this month`], ['Remaining hours', duration(stats.remaining), Activity, stats.remaining < 0 ? 'Beyond your monthly allocation' : 'Room to keep moving forward'] ];
  return <>
    <div className="overview-caption"><span className="section-label">MONTHLY OVERVIEW</span><span><span className="status-dot"/> {MONTHS[m - 1]} {year}</span></div>
    <div className="metrics-grid">{metrics.map(([label, value, Icon, note], i) => <div className={`metric-card metric-${i}`} key={label}><div className="metric-label">{label}<span className="metric-icon"><Icon size={17}/></span></div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div>)}</div>
    <div className="completion-strip"><div className="completion-icon"><Check size={19}/></div><div><strong>{stats.percent}% of your monthly goal</strong><span>{stats.allocated ? 'Every focused hour adds up. Keep your momentum going.' : 'Add websites and set monthly targets to start tracking progress.'}</span></div><div className="completion-track"><i style={{ width: `${Math.min(stats.percent, 100)}%` }}/></div><span className="completion-fraction">{duration(stats.actual)} <span>/ {duration(stats.allocated)}</span></span></div>
    <div className="dashboard-columns"><section className="panel website-progress"><div className="panel-heading"><div><h2>Website progress <span className="count-badge">{stats.rows.length}</span></h2><p>A little attention to every corner of your portfolio.</p></div><button className="text-button" onClick={() => onNavigate('My Websites')}>View all <ArrowUpRight size={15}/></button></div>{!stats.rows.length ? <Empty title="Your next chapter starts here" text="Add your first website and give your working hours a home." action="Add a website" onAction={() => onNavigate('My Websites')}/> : <><div className="progress-table-head"><span>WEBSITE</span><span>HOURS / TARGET</span><span>PROGRESS</span></div>{stats.rows.slice(0, 6).map((w, i) => <div className="progress-row" key={w.id}><div className="website-identity"><SiteIcon website={w} index={i}/><div><strong>{w.name}</strong><small>{new URL(w.url).hostname}</small></div></div><span className="hours-ratio">{duration(w.actual)} <span>/ {duration(w.allocated)}</span></span><button className={`row-progress ${w.extra ? 'over' : ''}`} onClick={() => onTarget(w)} title="Set monthly target"><span className="track"><i style={{ width: `${Math.min(w.percent, 100)}%`, background: w.extra ? '#b78d5b' : COLORS[i % COLORS.length] }}/></span><span>{w.percent}%</span></button></div>)}</>}</section>
    <section className="panel monthly-chart"><div className="panel-heading"><div><h2>Time, in perspective</h2><p>Your cumulative hours this month.</p></div><span className="chart-period">{MONTHS[m - 1].slice(0, 3)}</span></div><div className="chart-summary"><strong>{(stats.actual / 60).toLocaleString('en', { maximumFractionDigits: 1 })}<span> hrs</span></strong><span className="soft-badge">{stats.percent}% of target</span></div><div className="chart-container"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 15, right: 12, left: -22, bottom: 0 }}><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#759275" stopOpacity={0.22}/><stop offset="100%" stopColor="#759275" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--border)"/><XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={28} tick={{ fontSize: 11, fill: 'var(--muted)' }}/><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }}/><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} labelFormatter={d => `${MONTHS[m - 1]} ${d}`} formatter={(v, n) => [`${v} hrs`, n === 'worked' ? 'Hours worked' : 'Target pace']}/><Area isAnimationActive={false} type="monotone" dataKey="target" stroke="#c0baa9" strokeWidth={1.5} strokeDasharray="5 5" fill="none"/><Area isAnimationActive={false} type="monotone" dataKey="worked" stroke="#658265" strokeWidth={2.5} fill="url(#areaFill)"/></AreaChart></ResponsiveContainer></div><div className="chart-legend"><span><i/>Hours worked</span><span><i className="legend-target"/>Target pace</span></div></section></div>
    <div className="dashboard-columns bottom-columns"><section className="panel"><div className="panel-heading"><div><h2>Recent work</h2><p>The work behind your progress.</p></div><button className="text-button" onClick={() => onNavigate('Work Logs')}>All work logs <ArrowUpRight size={15}/></button></div>{!logs.length ? <Empty icon={Clock3} title="Make your first hour count" text="Log the work you've done and see your progress take shape." action="Log work" onAction={() => onLog(`${month}-01`)}/> : <div className="recent-list">{logs.slice(0, 4).map(l => { const w = data.websites.find(w => w.id === l.websiteId); return <button className="recent-row" key={l.id} onClick={() => onLog(l.date, l)}><span className="recent-icon"><Clock3 size={16}/></span><div><strong>{l.description}</strong><small>{w?.name}<span>·</span>{l.category}</small></div><div className="recent-time"><strong>{duration(l.totalMinutes)}</strong><small>{prettyDate(l.date)}</small></div><ChevronRight size={14}/></button>; })}</div>}</section><section className="panel attention-panel"><div className="panel-heading"><div><h2>A little attention</h2><p>Stay in tune with your monthly targets.</p></div><Activity size={18}/></div><div className="attention-item"><span className="attention-indicator amber"/><div><strong>{exceeded.length ? `${exceeded.length} ${exceeded.length === 1 ? 'website has' : 'websites have'} gone the extra mile` : 'Within your allocations'}</strong><p>{exceeded.length ? `${exceeded.map(w => w.name).join(', ')} · ${duration(exceeded.reduce((s, w) => s + w.extra, 0))} over target` : 'No websites have exceeded their monthly targets.'}</p></div></div><div className="attention-item"><span className="attention-indicator green"/><div><strong>{behind.length ? `${behind.length} ${behind.length === 1 ? 'website could' : 'websites could'} use some time` : 'Everything is up to date'}</strong><p>{behind.length ? `${behind.slice(0, 3).map(w => w.name).join(', ')}${behind.length > 3 ? ` +${behind.length - 3} more` : ''} still have hours to fill.` : 'Your active websites are on track for the month.'}</p></div></div><div className="attention-footer"><span>Find your next focus.</span><button className="text-button" onClick={() => onNavigate('My Websites')}>Review websites <ArrowRight size={14}/></button></div></section></div>
  </>;
}

function Websites({ data, stats, search, setSearch, onAdd, onEdit, onDelete, onTarget, onToggle, onExport, onExportAll, exporting, canEdit }) {
  const [status, setStatus] = useState('All');
  const rows = data.websites.filter(w => (!search || `${w.name} ${w.url}`.toLowerCase().includes(search.toLowerCase())) && (status === 'All' || w.status === status));
  return <>
    <div className="toolbar websites-toolbar">
      <SearchBox {...{ search, setSearch }} placeholder="Search websites…"/>
      <div className="segmented">{['All', 'Active', 'Inactive'].map(s => <button className={status === s ? 'selected' : ''} onClick={() => setStatus(s)} key={s}>{s}</button>)}</div>
      <div className="project-export-actions">
        <button className="button secondary" disabled={exporting} onClick={() => onExportAll('xlsx')}><ArrowDownToLine size={15}/>All projects Excel</button>
        <button className="button secondary" disabled={exporting} onClick={() => onExportAll('csv')}><ArrowDownToLine size={15}/>All projects CSV</button>
      </div>
      <span className="muted toolbar-count">{rows.length} websites</span>
    </div>
    {!rows.length ? <section className="panel"><Empty title={data.websites.length ? 'No websites found' : 'A home for your websites'} text="Add your websites, set a monthly target, and let your progress take shape." action={canEdit ? 'Add website' : undefined} onAction={onAdd}/></section> : <div className="website-grid">{rows.map((w, i) => {
      const s = stats.rows.find(r => r.id === w.id);
      return <article className="panel website-card" key={w.id}>
        <div className="website-card-top"><SiteIcon website={w} index={i}/><span className={`badge ${w.status === 'Inactive' ? 'neutral' : ''}`}><span className="status-dot"/>{w.status}</span></div>
        <h2>{w.name}</h2>
        <a className="website-url" href={w.url} target="_blank" rel="noreferrer">{new URL(w.url).hostname}<ExternalLink size={12}/></a>
        <p className="website-description">{w.description || 'A little progress starts with a little time.'}</p>
        <div className="card-allocation"><span>Monthly progress</span><strong>{duration(s?.actual || 0)} <span>/ {duration(s?.allocated ?? Math.round(w.defaultMonthlyHours * 60))}</span></strong></div>
        <div className="track"><i style={{ width: `${Math.min(s?.percent || 0, 100)}%`, background: COLORS[i % COLORS.length] }}/></div>
        <div className="website-start">Since {prettyDate(w.startDate, { year: 'numeric' })}</div>
        <div className="website-card-actions">
          {canEdit && <button className="text-button" onClick={() => onTarget(w)}>Set target <ArrowUpRight size={14}/></button>}
          <div className="website-card-tools">
            <div className="website-export-actions">
              <button className="text-button" aria-label={`Export ${w.name} as Excel`} title={`Export ${w.name} as Excel`} disabled={exporting} onClick={() => onExport(w, 'xlsx')}>Excel</button>
              <button className="text-button" aria-label={`Export ${w.name} as CSV`} title={`Export ${w.name} as CSV`} disabled={exporting} onClick={() => onExport(w, 'csv')}>CSV</button>
            </div>
            {canEdit && <div className="website-row-actions">
              <button className="icon-button" title={w.status === 'Active' ? 'Deactivate website' : 'Activate website'} onClick={() => onToggle(w)}><Activity size={16}/></button>
              <button className="icon-button" title="Edit website" onClick={() => onEdit(w)}><Pencil size={16}/></button>
              <button className="icon-button danger-text" title="Delete website" onClick={() => onDelete(w)}><Trash2 size={16}/></button>
            </div>}
          </div>
        </div>
      </article>;
    })}</div>}
  </>;
}

function SearchBox({ search, setSearch, placeholder }) { return <label className="search-box"><Search size={16}/><input aria-label={placeholder} placeholder={placeholder} value={search} onChange={e => setSearch(e.target.value)}/>{search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14}/></button>}</label>; }
function Calendar({ data, year, monthNumber, setMonth, onDay }) {
  const [view, setView] = useState('Year');
  const totals = useMemo(() => data.logs.reduce((a, l) => { a[l.date] = (a[l.date] || 0) + l.totalMinutes; return a; }, {}), [data.logs]);
  return <><div className="toolbar"><div className="year-nav"><button className="icon-button" aria-label="Previous year" disabled={year <= 1900} onClick={() => setMonth(monthKey(year - 1, monthNumber))}><ChevronLeft size={18}/></button><strong>{year}</strong><button className="icon-button" aria-label="Next year" disabled={year >= 2200} onClick={() => setMonth(monthKey(year + 1, monthNumber))}><ChevronRight size={18}/></button></div><div className="segmented">{['Year', 'Month'].map(v => <button key={v} className={view === v ? 'selected' : ''} onClick={() => setView(v)}>{v} view</button>)}</div><span className="calendar-key"><i/>Work logged<span className="muted">Select any day to log work</span></span></div><div className={view === 'Year' ? 'year-grid' : 'month-view'}>{(view === 'Year' ? Array.from({ length: 12 }, (_, i) => i + 1) : [monthNumber]).map(m => <MonthCalendar key={`${year}-${m}`} {...{ year, totals, onDay }} month={m} large={view === 'Month'}/>)}</div></>;
}
function MonthCalendar({ year, month, totals, onDay, large }) {
  const first = (new Date(year, month - 1, 1).getDay() + 6) % 7, count = new Date(year, month, 0).getDate(), prefix = monthKey(year, month);
  return <section className={`panel calendar-month ${large ? 'large' : ''}`}><div className="calendar-month-title"><h2>{MONTHS[month - 1]}</h2><span>{duration(Object.entries(totals).filter(([k]) => k.startsWith(prefix)).reduce((n, [, v]) => n + v, 0))}</span></div><div className="calendar-days">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span className="weekday" key={i}>{d}</span>)}{Array.from({ length: first }, (_, i) => <span key={`blank-${i}`} className="blank-day"/>)}{Array.from({ length: count }, (_, i) => { const day = `${prefix}-${String(i + 1).padStart(2, '0')}`, total = totals[day]; return <button key={day} className={`calendar-day ${total ? 'has-work' : ''} ${day === dateKey() ? 'today' : ''}`} title={`${prettyDate(day)}: ${total ? duration(total) : 'No activity'}`} onClick={() => onDay(day)}><span>{i + 1}</span>{total ? <small>{large ? duration(total) : `${+(total / 60).toFixed(1)}h`}</small> : large ? <small className="no-activity">No activity</small> : null}</button>; })}</div></section>;
}
function Logs({ data, month, search, setSearch, onAdd, onEdit, onDelete, onDuplicate }) {
  const [websiteId, setWebsite] = useState(''), [category, setCategory] = useState('');
  const logs = reportRows(data.logs, { websiteId, category, from: `${month}-01`, to: `${month}-31` }).filter(l => `${l.description} ${l.notes} ${data.websites.find(w => w.id === l.websiteId)?.name}`.toLowerCase().includes(search.toLowerCase()));
  return <><div className="toolbar"><SearchBox {...{ search, setSearch }} placeholder="Search work logs…"/><select aria-label="Filter website" value={websiteId} onChange={e => setWebsite(e.target.value)}><option value="">All websites</option>{data.websites.map(w => <option value={w.id} key={w.id}>{w.name}</option>)}</select><select aria-label="Filter category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select><span className="muted toolbar-count">{duration(logs.reduce((n, l) => n + l.totalMinutes, 0))} · {logs.length} entries</span></div><section className="panel">{logs.length ? <LogTable {...{ logs, data, onEdit, onDelete, onDuplicate }}/> : <Empty icon={Clock3} title="A fresh page for your work" text="No work logs match this view. Add an entry to get started." action={onAdd ? 'Log work' : undefined} onAction={onAdd}/>}</section></>;
}
function LogTable({ logs, data, onEdit, onDelete, onDuplicate }) { return <div className="table-scroll"><table><thead><tr><th>Date</th><th>Website & task</th><th>Category</th><th>Time spent</th>{onEdit && <th>Actions</th>}</tr></thead><tbody>{logs.map(l => <tr key={l.id}><td className="nowrap">{prettyDate(l.date, { year: 'numeric' })}</td><td><strong className="table-website">{data.websites.find(w => w.id === l.websiteId)?.name || 'Deleted website'}</strong><span className="table-description">{l.description}</span>{l.notes && <small className="muted table-notes">{l.notes}</small>}</td><td><span className={`category category-${categories.indexOf(l.category)}`}>{l.category}</span></td><td className="nowrap strong">{duration(l.totalMinutes)}</td>{onEdit && <td><div className="table-actions"><button className="icon-button" title="Edit entry" onClick={() => onEdit(l)}><Pencil size={15}/></button><button className="icon-button" title="Duplicate entry" onClick={() => onDuplicate(l)}><Copy size={15}/></button><button className="icon-button danger-text" title="Delete entry" onClick={() => onDelete(l)}><Trash2 size={15}/></button></div></td>}</tr>)}</tbody></table></div>; }

function Reports({ data, month }) {
  const [period, setPeriod] = useState('Monthly'), [websiteId, setWebsite] = useState(''), [category, setCategory] = useState('');
  const [from, setFrom] = useState(`${month}-01`), [to, setTo] = useState(`${month}-${new Date(+month.slice(0, 4), +month.slice(5), 0).getDate()}`);
  const [group, setGroup] = useState('Website');
  useEffect(() => { if (period === 'Custom') return; let a = `${month}-01`, b = `${month}-${new Date(+month.slice(0, 4), +month.slice(5), 0).getDate()}`; if (period === 'Yearly') { a = `${month.slice(0, 4)}-01-01`; b = `${month.slice(0, 4)}-12-31`; } else if (period === 'Daily') { a = month === dateKey().slice(0, 7) ? dateKey() : a; b = a; } else if (period === 'Weekly') { const day = new Date((month === dateKey().slice(0, 7) ? dateKey() : a) + 'T12:00:00'); day.setDate(day.getDate() - (day.getDay() + 6) % 7); a = dateKey(day); day.setDate(day.getDate() + 6); b = dateKey(day); } setFrom(a); setTo(b); }, [period, month]);
  const filters = { websiteId, category, from, to };
  const logs = reportRows(data.logs, filters), total = logs.reduce((s, l) => s + l.totalMinutes, 0), days = new Set(logs.map(l => l.date)).size;
  const aggregates = {};
  logs.forEach(l => { const key = group === 'Category' ? l.category : group === 'Day' ? l.date : data.websites.find(w => w.id === l.websiteId)?.name || 'Deleted website'; aggregates[key] = (aggregates[key] || 0) + l.totalMinutes; });
  const chart = Object.entries(aggregates).map(([name, minutes]) => ({ name, hours: +(minutes / 60).toFixed(2) }));
  return <><div className="toolbar reports-toolbar"><select aria-label="Report period" value={period} onChange={e => setPeriod(e.target.value)}>{['Daily', 'Weekly', 'Monthly', 'Yearly', 'Custom'].map(p => <option key={p}>{p}</option>)}</select><input type="date" aria-label="Start date" value={from} max={to} onChange={e => { setPeriod('Custom'); setFrom(e.target.value); }}/><span className="muted">to</span><input type="date" aria-label="End date" value={to} min={from} onChange={e => { setPeriod('Custom'); setTo(e.target.value); }}/><select aria-label="Report website" value={websiteId} onChange={e => setWebsite(e.target.value)}><option value="">All websites</option>{data.websites.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select><select aria-label="Report category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select></div><div className="report-summary"><div className="panel"><small>TOTAL TIME</small><strong>{duration(total)}</strong></div><div className="panel"><small>WORK ENTRIES</small><strong>{logs.length}</strong></div><div className="panel"><small>ACTIVE DAYS</small><strong>{days}</strong></div><div className="panel"><small>AVERAGE / ACTIVE DAY</small><strong>{duration(days ? total / days : 0)}</strong></div></div><section className="panel report-chart"><div className="panel-heading"><div><h2>Where your time goes</h2><p>Hours worked, grouped by {group.toLowerCase()}.</p></div><select aria-label="Group report by" value={group} onChange={e => setGroup(e.target.value)}>{['Website', 'Category', 'Day'].map(v => <option key={v}>{v}</option>)}</select></div>{chart.length ? <div className="report-chart-container"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{ left: -20, right: 20, bottom: 20 }}><CartesianGrid strokeDasharray="3 4" vertical={false} stroke="var(--border)"/><XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval={0} tickFormatter={v => v.length > 18 ? v.slice(0, 16) + '…' : v}/><YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }}/><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} formatter={v => [`${v} hours`, 'Work time']}/><Bar isAnimationActive={false} dataKey="hours" radius={[5, 5, 0, 0]} maxBarSize={65}>{chart.map((v, i) => <Cell key={v.name} fill={COLORS[i % COLORS.length]}/>)}</Bar></BarChart></ResponsiveContainer></div> : <Empty icon={ChartNoAxesCombined} title="Your story is still taking shape" text="Work logged in this date range will appear here."/>}</section><section className="panel report-table"><div className="panel-heading"><div><h2>Work report</h2><p>{logs.length} entries · {from || 'All dates'} — {to || 'Today'}</p></div><div className="export-actions">{['csv', 'xlsx'].map(format => <button key={format} className="button secondary" onClick={() => download(`/export/${format}?${new URLSearchParams(filters)}`)}><ArrowDownToLine size={15}/>{format === 'csv' ? 'CSV' : 'Excel'}</button>)}</div></div>{logs.length ? <LogTable {...{ logs, data }}/> : <p className="no-rows">No entries match these filters.</p>}</section></>;
}

function UserManagement() {
  const [users, setUsers] = useState([]), [query, setQuery] = useState(''), [showAudit, setShowAudit] = useState(false), [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [modal, setModal] = useState(null);
  const loadUsers = async () => { setLoading(true); try { setUsers(await api('/users')); setError(''); } catch (requestError) { setError(requestError.message); } finally { setLoading(false); } };
  const loadAudit = async () => { setBusy(true); try { setAudit(await api('/audit-logs?limit=250')); setShowAudit(true); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } };
  useEffect(() => { loadUsers(); }, []);
  const filtered = users.filter(account => `${account.name} ${account.email} ${account.username || ''}`.toLowerCase().includes(query.toLowerCase()));
  async function saveUser(value) {
    setBusy(true); setError('');
    try { await api(modal.value ? `/users/${modal.value.id}` : '/users', { method: modal.value ? 'PUT' : 'POST', body: JSON.stringify(value) }); setNotice(modal.value ? 'User details updated.' : 'Account created and invitation emailed.'); setModal(null); await loadUsers(); }
    catch (requestError) { setError(requestError.message); throw requestError; }
    finally { setBusy(false); }
  }
  async function updateStatus(account) {
    setBusy(true); setError('');
    try { await api(`/users/${account.id}`, { method: 'PUT', body: JSON.stringify({ status: account.status === 'active' ? 'inactive' : 'active' }) }); setNotice(`Account ${account.status === 'active' ? 'deactivated' : 'reactivated'}.`); await loadUsers(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  async function resetPassword(account) {
    setBusy(true); setError('');
    try { await api(`/users/${account.id}/reset-password`, { method: 'POST' }); setNotice(`Temporary password emailed to ${account.email}.`); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  async function deleteUser(account) {
    setBusy(true); setError('');
    try { await api(`/users/${account.id}`, { method: 'DELETE' }); setModal(null); setNotice('User deleted.'); await loadUsers(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  return <>
    <div className="toolbar user-management-toolbar"><label className="search-box"><Search size={16}/><input aria-label="Search users" placeholder="Search name or email…" value={query} onChange={event => setQuery(event.target.value)}/></label><span className="muted toolbar-count">{filtered.length} users</span><button className="button secondary" onClick={() => showAudit ? setShowAudit(false) : loadAudit()} disabled={busy}><Activity size={15}/>{showAudit ? 'Users' : 'Audit log'}</button><button className="button primary" onClick={() => { setError(''); setModal({ type: 'user' }); }}><Plus size={16}/>Add New User</button></div>
    {error && <div className="alert error" role="alert">{error}<button className="icon-button" aria-label="Dismiss user-management error" onClick={() => setError('')}><X size={15}/></button></div>}
    {notice && <div className="alert user-notice" role="status">{notice}<button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={15}/></button></div>}
    {showAudit ? <section className="panel user-table-panel"><div className="panel-heading"><div><h2>Activity log</h2><p>Recent account and workspace changes.</p></div></div>{!audit.length ? <p className="no-rows">No audit activity yet.</p> : <div className="table-scroll"><table><thead><tr><th>Date and time</th><th>User</th><th>Role</th><th>Action</th><th>Affected record</th><th>Details</th></tr></thead><tbody>{audit.map(entry => <tr key={entry.id}><td className="nowrap">{formatDateTime(entry.createdAt)}</td><td>{entry.userName}</td><td><RoleBadge role={entry.userRole}/></td><td>{entry.action}</td><td>{entry.resourceType}{entry.resourceId ? ` · ${entry.resourceId}` : ''}</td><td>{Object.keys(entry.details || {}).length ? JSON.stringify(entry.details) : '—'}</td></tr>)}</tbody></table></div>}</section> : <section className="panel user-table-panel">{loading ? <div className="loading-line" role="status">Loading users…</div> : !filtered.length ? <p className="no-rows">{users.length ? 'No users match that search.' : 'No user accounts found.'}</p> : <div className="table-scroll"><table><thead><tr><th>User Name</th><th>Email Address</th><th>Assigned Role</th><th>Account Status</th><th>Created Date</th><th>Last Login</th><th>Actions</th></tr></thead><tbody>{filtered.map(account => <tr key={account.id}><td><strong>{account.name}</strong>{account.username && <small className="user-username">@{account.username}</small>}</td><td>{account.email}</td><td><RoleBadge role={account.role}/>{account.isPrimaryAdmin && <small className="owner-label">Primary owner</small>}</td><td><span className={`user-status ${account.status}`}>{account.status}</span></td><td className="nowrap">{formatDateTime(account.createdAt, false)}</td><td className="nowrap">{formatDateTime(account.lastLogin, false)}</td><td><div className="user-actions"><button className="icon-button" title="Edit user" aria-label={`Edit ${account.name}`} onClick={() => { setError(''); setModal({ type: 'user', value: account }); }}><Pencil size={15}/></button>{!account.isPrimaryAdmin && <><button className="icon-button" title={account.status === 'active' ? 'Deactivate user' : 'Reactivate user'} aria-label={`${account.status === 'active' ? 'Deactivate' : 'Reactivate'} ${account.name}`} disabled={busy} onClick={() => updateStatus(account)}><Activity size={15}/></button><button className="icon-button" title="Send temporary password" aria-label={`Reset password for ${account.name}`} disabled={busy} onClick={() => resetPassword(account)}><KeyRound size={15}/></button><button className="icon-button danger-text" title="Delete user" aria-label={`Delete ${account.name}`} disabled={busy} onClick={() => setModal({ type: 'delete', value: account })}><Trash2 size={15}/></button></>}</div></td></tr>)}</tbody></table></div>}</section>}
    {modal && <Modal title={modal.type === 'delete' ? 'Delete user?' : modal.value ? 'Edit user' : 'Add new user'} onClose={() => !busy && setModal(null)}>{modal.type === 'delete' ? <DeleteForm busy={busy} text={`Delete ${modal.value.name} (${modal.value.email})? They will lose access immediately.`} onConfirm={() => deleteUser(modal.value)}/> : <UserForm value={modal.value} busy={busy} onSave={saveUser}/>}</Modal>}
  </>;
}

function RoleBadge({ role }) { const Icon = role === 'admin' ? ShieldCheck : role === 'viewer' ? Eye : Users; return <span className={`role-badge role-${role}`}><Icon size={13}/>{role[0].toUpperCase() + role.slice(1)}</span>; }
function formatDateTime(value, includeTime = true) { return value ? new Date(value).toLocaleString('en', includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }) : 'Never'; }
function UserForm({ value, busy, onSave }) {
  const [error, setError] = useState('');
  return <form className="form" onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const password = form.get('password'); if (!value && password !== form.get('confirmPassword')) { setError('Passwords do not match.'); return; } const data = { name: form.get('name'), email: form.get('email'), username: form.get('username') }; const role = form.get('role'), status = form.get('status'); if (role) data.role = role; if (status) data.status = status; if (!value) data.password = password; try { setError(''); await onSave(data); } catch (requestError) { setError(requestError.message); } }}>
    <FormError error={error}/><label>Full name<input name="name" defaultValue={value?.name} autoComplete="name" maxLength={100} required/></label><label>Email address<input name="email" type="email" defaultValue={value?.email} autoComplete="email" maxLength={254} required/></label><label>Username <span className="muted">(optional)</span><input name="username" defaultValue={value?.username || ''} autoComplete="username" maxLength={40}/></label>
    {!value && <><label>Temporary password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label><label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label><p className="muted">The user will be required to change this password at first sign-in.</p></>}
    <div className="form-columns"><label>Role<select name="role" defaultValue={value?.role || 'editor'} disabled={value?.isPrimaryAdmin}>{['admin', 'editor', 'viewer'].map(role => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}</select></label><label>Account status<select name="status" defaultValue={value?.status || 'active'} disabled={value?.isPrimaryAdmin}><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div>
    {value?.isPrimaryAdmin && <p className="muted">The primary owner cannot be downgraded or deactivated.</p>}<button className="button primary full-width" disabled={busy}>{busy ? 'Saving…' : value ? 'Save user' : 'Create account'}<Check size={16}/></button>
  </form>;
}

function Settings({ user, theme, setTheme, onHelp }) { return <div className="settings-grid"><section className="panel settings-card"><h2>Your workspace</h2><p className="muted">A personal space for thoughtful work.</p><div className="settings-row"><span>Name</span><strong>{user.name}</strong></div><div className="settings-row"><span>Email</span><strong>{user.email}</strong></div><div className="settings-row"><span>Appearance</span><div className="segmented">{['light', 'dark'].map(t => <button key={t} className={theme === t ? 'selected' : ''} onClick={() => setTheme(t)}>{t === 'light' ? <Sun size={14}/> : <Moon size={14}/>}{t[0].toUpperCase() + t.slice(1)}</button>)}</div></div></section><section className="panel settings-card"><h2>Your data, on your terms.</h2><p className="muted">Download all your websites, work logs, and monthly allocations as a JSON backup. Account passwords are never included.</p><button className="button secondary" onClick={() => download('/backup')}><ArrowDownToLine size={16}/>Download full backup</button><div className="settings-divider"/><h2>A little guidance</h2><p className="muted">Find your way around your workspace.</p><button className="text-button" onClick={onHelp}>Getting started with Tempo <ArrowUpRight size={15}/></button></section></div>; }

function Modal({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => { const previous = document.activeElement; document.body.style.overflow = 'hidden'; const el = ref.current; el.focus(); const handler = e => { if (e.key === 'Escape') onClose(); if (e.key === 'Tab') { const nodes = [...el.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter(n => !n.disabled && n.offsetParent !== null); const first = nodes[0], last = nodes.at(-1); if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }; document.addEventListener('keydown', handler); return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', handler); previous?.focus(); }; }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabIndex={-1} ref={ref}><div className="modal-heading"><div><span className="eyebrow">A LITTLE PROGRESS</span><h2 id="dialog-title">{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21}/></button></div>{children}</section></div>;
}
function FormError({ error }) { return error ? <div role="alert" className="alert error">{error}</div> : null; }
function WebsiteForm({ value, busy, onSave }) { const [error, setError] = useState(''); return <form className="form" onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); try { setError(''); await onSave({ name: f.get('name'), url: f.get('url'), description: f.get('description'), defaultMonthlyHours: Number(f.get('allocation')), startDate: f.get('startDate'), status: f.get('status') }); } catch(e) { setError(e.message); } }}><FormError error={error}/><label>Website name<input name="name" defaultValue={value?.name} placeholder="e.g. Studio North" maxLength={120} required/></label><label>Website URL<input name="url" type="url" defaultValue={value?.url} placeholder="https://example.com" required/></label><label>Description<textarea name="description" defaultValue={value?.description} placeholder="A little context about this project…" maxLength={2000} rows={3}/></label><div className="form-columns"><label>Default monthly hours<input name="allocation" type="number" min="0" max="744" step="0.25" defaultValue={value?.defaultMonthlyHours ?? 12} required/></label><label>Project start date<input name="startDate" type="date" min="1900-01-01" max="2200-12-31" defaultValue={value?.startDate || dateKey()} required/></label></div><label>Status<select name="status" defaultValue={value?.status || 'Active'}><option>Active</option><option>Inactive</option></select></label><button className="button primary full-width" disabled={busy}>{busy ? 'Saving…' : 'Save website'}<Check size={16}/></button></form>; }
function LogForm({ data, date, value, busy, onSave }) {
  const initialWebsiteId = value?.websiteId || data.websites.find(w => w.status === 'Active')?.id || data.websites[0]?.id || '';
  const [error, setError] = useState('');
  const [query, setQuery] = useState(() => data.websites.find(w => w.id === initialWebsiteId)?.name || '');
  const [websiteId, setWebsite] = useState(initialWebsiteId);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false), [filtering, setFiltering] = useState(false), [activeIndex, setActiveIndex] = useState(0);
  const websiteSelectRef = useRef(null);
  const websites = data.websites.filter(w => !filtering || w.name.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    const closeOnOutsideClick = event => {
      if (!websiteSelectRef.current?.contains(event.target)) { setSuggestionsOpen(false); setFiltering(false); }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);
  const chooseWebsite = website => { setWebsite(website.id); setQuery(website.name); setFiltering(false); setSuggestionsOpen(false); setActiveIndex(0); };
  const handleWebsiteKeyDown = event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSuggestionsOpen(true); setActiveIndex(index => websites.length ? Math.min(index < 0 ? 0 : index + 1, websites.length - 1) : -1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSuggestionsOpen(true); setActiveIndex(index => websites.length ? index < 0 ? websites.length - 1 : Math.max(index - 1, 0) : -1); }
    else if (event.key === 'Enter' && suggestionsOpen) { event.preventDefault(); const website = websites[activeIndex] || websites[0]; if (website) chooseWebsite(website); }
    else if (event.key === 'Escape' && suggestionsOpen) { event.preventDefault(); event.stopPropagation(); setSuggestionsOpen(false); setFiltering(false); }
  };
  return <form className="form" onSubmit={async e => {
    e.preventDefault();
    if (!data.websites.some(website => website.id === websiteId)) { setError('Select a website from the suggestions.'); setSuggestionsOpen(true); return; }
    const f = new FormData(e.currentTarget);
    try { setError(''); await onSave({ websiteId, date: f.get('date'), description: f.get('description'), category: f.get('category'), hours: Number(f.get('hours')), minutes: Number(f.get('minutes')), notes: f.get('notes') }); } catch (e) { setError(e.message); }
  }}>
    <FormError error={error}/>
    <label>Date<input name="date" type="date" min="1900-01-01" max="2200-12-31" required defaultValue={value?.date || date}/></label>
    <label>Website
      <div className="website-select" ref={websiteSelectRef}>
        <input type="search" role="combobox" aria-label="Website" aria-autocomplete="list" aria-expanded={suggestionsOpen} aria-controls="website-suggestions" aria-activedescendant={suggestionsOpen && websites[activeIndex] ? `website-option-${websites[activeIndex].id}` : undefined} autoComplete="off" placeholder="Search your websites…" value={query} required onFocus={() => { setSuggestionsOpen(true); setFiltering(false); setActiveIndex(-1); }} onClick={event => { if (websiteId) event.currentTarget.select(); setSuggestionsOpen(true); setFiltering(false); setActiveIndex(-1); }} onChange={event => { setQuery(event.target.value); setWebsite(''); setFiltering(true); setSuggestionsOpen(true); setActiveIndex(-1); }} onKeyDown={handleWebsiteKeyDown}/>
        {suggestionsOpen && <div className="website-options" id="website-suggestions" role="listbox" aria-label="Matching websites">
          {websites.length ? websites.map((website, index) => <button id={`website-option-${website.id}`} key={website.id} type="button" role="option" aria-selected={website.id === websiteId} className={`website-option ${index === activeIndex ? 'is-active' : ''}`} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => chooseWebsite(website)}><span>{website.name}</span>{website.status === 'Inactive' && <small>Inactive</small>}</button>) : <div className="website-option-empty" role="status">No matching website found.</div>}
        </div>}
      </div>
    </label>
    <label>What did you work on?<textarea name="description" defaultValue={value?.description} placeholder="Made the homepage feel a little more like home…" required maxLength={2000} rows={3}/></label>
    <div className="form-columns"><label>Hours<input type="number" min="0" max="24" name="hours" defaultValue={value?.hours ?? 1} required/></label><label>Minutes<input type="number" min="0" max="59" name="minutes" defaultValue={value?.minutes ?? 0} required/></label></div>
    <label>Work category<select name="category" defaultValue={value?.category || 'Development'}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
    <label>Notes <span className="muted">(optional)</span><textarea name="notes" defaultValue={value?.notes} maxLength={5000} placeholder="Anything worth remembering." rows={2}/></label>
    <button className="button primary full-width" disabled={busy}>{busy ? 'Saving…' : 'Save work log'}<Check size={16}/></button>
  </form>;
}
function TargetForm({ website, month, data, busy, onSave, onReset }) {
  const [selected, setSelected] = useState(month), [error, setError] = useState('');
  const [y, m] = selected.split('-').map(Number), override = data.allocations.find(a => a.websiteId === website.id && a.year === y && a.month === m);
  return <form className="form" onSubmit={async e => { e.preventDefault(); try { setError(''); await onSave({ websiteId: website.id, year: y, month: m, allocatedHours: Number(new FormData(e.currentTarget).get('hours')) }); } catch(e) { setError(e.message); } }}><FormError error={error}/><p className="muted">Give <strong>{website.name}</strong> a target for a specific month. Your default is {website.defaultMonthlyHours} hours.</p><label>Month<input type="month" min="1900-01" max="2200-12" value={selected} onChange={e => e.target.value && setSelected(e.target.value)} required/></label><label key={selected}>Allocated hours<input type="number" name="hours" min="0" max="744" step="0.25" defaultValue={override?.allocatedHours ?? website.defaultMonthlyHours} required/></label><button className="button primary full-width" disabled={busy}>{busy ? 'Saving…' : 'Save monthly target'}</button>{override && <button className="button secondary full-width" type="button" disabled={busy} onClick={async () => { try { await onReset(override); } catch(e) { setError(e.message); } }}>Restore default allocation</button>}</form>;
}
function DeleteForm({ text, busy, onConfirm }) { const [error, setError] = useState(''); return <div className="form"><FormError error={error}/><p className="muted">{text} This cannot be undone.</p><button className="button danger full-width" disabled={busy} onClick={async () => { try { await onConfirm(); } catch(e) { setError(e.message); } }}>{busy ? 'Deleting…' : 'Permanently delete'}</button></div>; }
createRoot(document.getElementById('root')).render(<App/>);
