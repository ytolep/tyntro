'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';

// Колокольчик уведомлений (K3). Опрос /api/notifications раз в 30 с и только
// для вошедшего (useAuth — общий контракт). Классы шапки переиспользуем,
// новых стилей в globals.css не заводим.

type NotificationDto = {
  id: string;
  kind: string;
  title: string;
  body: string;
  accountId: string | null;
  readAt: string | null;
  createdAt: string;
};

const ago = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
};

export default function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications');
      if (!r.ok) return;
      const j = (await r.json()) as { notifications: NotificationDto[]; unreadCount: number };
      setItems(j.notifications);
      setUnread(j.unreadCount);
    } catch {
      // сеть моргнула — следующий 30-секундный тик дообновит
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setUnread(0);
      setOpen(false);
      return;
    }
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [user, load]);

  // Закрытие по Escape и клику мимо — как у остальных дропдаунов шапки.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const click = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', click);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', click);
    };
  }, [open]);

  const markRead = async (payload: { ids: string[] } | { all: true }) => {
    await fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
    await load();
  };

  if (!user) return null;

  return (
    <div className="nav-dropdown" ref={box}>
      <button
        className="account-button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => setOpen(!open)}
        style={{ position: 'relative' }}
      >
        <Bell size={14} />
        {unread > 0 && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: -5,
              right: -5,
              background: 'var(--violet)',
              color: '#151021',
              font: '700 9px ui-monospace,monospace',
              borderRadius: 8,
              minWidth: 16,
              padding: '1px 4px',
              textAlign: 'center',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="dropdown-panel accounts-panel" role="menu">
          <span className="eyebrow">NOTIFICATIONS</span>
          {items.length === 0 && (
            <span style={{ display: 'block', padding: '14px 12px', color: 'var(--muted)', fontSize: 12 }}>
              Nothing yet — account events land here.
            </span>
          )}
          {items.map((n) => (
            <button key={n.id} role="menuitem" style={{ display: 'block' }} onClick={() => !n.readAt && void markRead({ ids: [n.id] })}>
              <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
                {!n.readAt && <i className="status-dot" style={{ marginTop: 6, flexShrink: 0 }} />}
                <span style={{ minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: 12, fontWeight: n.readAt ? 400 : 600, color: n.readAt ? '#a49bad' : '#eeedf4' }}>{n.title}</b>
                  <small style={{ display: 'block', marginTop: 3, fontSize: 11, lineHeight: 1.45, color: 'var(--muted)' }}>{n.body}</small>
                  <small style={{ display: 'block', marginTop: 4, font: '10px ui-monospace,monospace', color: '#77717f' }}>{ago(n.createdAt)}</small>
                </span>
                {n.readAt && <Check size={12} style={{ marginLeft: 'auto', flexShrink: 0, color: '#5c5568' }} />}
              </span>
            </button>
          ))}
          {unread > 0 && (
            <>
              <div className="menu-divider" />
              <button role="menuitem" onClick={() => void markRead({ all: true })}>
                <span>Mark all read</span>
                <Check size={13} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
