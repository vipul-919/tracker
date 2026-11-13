import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';

export default function WorkspaceDirectory({ user, onSync, onAccessLost }) {
  const [roster, setRoster] = useState(null), [error, setError] = useState('');
  const callbacks = useRef({ onSync, onAccessLost });
  callbacks.current = { onSync, onAccessLost };
  useEffect(() => {
    let disposed = false, running = false;
    const clientId = crypto.randomUUID();
    const headers = { 'X-Workspace-Id': user.workspaceId };
    const release = () => api('/workspace-presence', { method: 'POST', headers, body: JSON.stringify({ clientId, active: false }), keepalive: true }).catch(() => {});
    async function sync() {
      if (disposed || running) return;
      running = true;
      try {
        await api('/workspace-presence', { method: 'POST', headers, body: JSON.stringify({ clientId, active: document.visibilityState === 'visible' }) });
        if (disposed) return;
        const [directory, workspaces] = await Promise.all([api('/workspace-roster', { headers }), api('/workspaces')]);
        if (!disposed) { setRoster(directory); setError(''); callbacks.current.onSync(directory, workspaces); }
      } catch (e) {
        if (!disposed) {
          setRoster(null); setError('Member status unavailable. Retrying…');
          if (e.status === 401 || e.status === 403) callbacks.current.onAccessLost();
        }
      } finally { running = false; if (disposed) release(); }
    }
    sync();
    const timer = setInterval(sync, 10000);
    window.addEventListener('focus', sync);
    window.addEventListener('tempo-members-changed', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      disposed = true; clearInterval(timer);
      window.removeEventListener('focus', sync);
      window.removeEventListener('tempo-members-changed', sync);
      document.removeEventListener('visibilitychange', sync);
      release();
    };
  }, [user.id, user.workspaceId]);
  const members = [...(roster?.members || []), ...(roster?.invitations || [])];
  return <details className="workspace-directory">
    <summary>Workspace members <span>{roster ? members.length : '…'}</span></summary>
    <div className="workspace-directory-list" aria-label="Workspace member directory">
      <p className="muted">People in this workspace</p>
      {error && <p role="status">{error}</p>}
      {!roster && !error && <p role="status">Loading members…</p>}
      {members.map(m => <div className="directory-member" key={`${m.status}-${m.id}`}>
        <span className="directory-avatar" aria-hidden="true">{m.name?.slice(0, 1).toUpperCase()}<i className={`presence-dot ${m.online ? 'online' : ''}`}/></span>
        <div className="directory-details"><strong>{m.name}{m.id === user.id ? ' (you)' : ''}</strong><small>{m.email}</small><small>{m.role} · {m.status === 'active' ? (m.online ? 'Online' : 'Offline') : m.status === 'pending' ? 'Invited · awaiting acceptance' : 'Invitation expired'}</small></div>
      </div>)}
      <p className="muted">Status updates automatically.</p>
    </div>
  </details>;
}
