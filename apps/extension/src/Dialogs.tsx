import { useState, useEffect, type FormEvent } from 'react';
import {
  IconLoader2,
  IconStar,
  IconPlug,
  IconCheck,
  IconExternalLink,
  IconTrash,
} from '@tabler/icons-react';
import type { Report, Watch, ScanInput } from '@coinchecker/shared';
import {
  api,
  request,
  preferences,
  savePreferences,
  validateApiUrl,
  nativeExtension,
  type Preferences,
} from './client';
import { SUPPORTED_ORIGINS } from './detection';
import { Modal, Link } from './ui';

export function WatchDialog({
  report,
  existing,
  close,
  saved,
}: {
  report: Report;
  existing: Watch | null;
  close: () => void;
  saved: () => void;
}) {
  const [interval, setInterval] = useState(existing?.intervalMinutes || 15),
    [tax, setTax] = useState(existing?.taxThreshold ?? 10),
    [drop, setDrop] = useState(existing?.liquidityDropPercent ?? 30),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.watch({
        chainId: report.chainId,
        address: report.address as ScanInput['address'],
        pairAddress: report.pairAddress as ScanInput['pairAddress'],
        label: report.symbol,
        intervalMinutes: interval,
        taxThreshold: tax,
        liquidityDropPercent: drop,
      });
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Watch ${report.symbol}`} onClose={close}>
      <p className="muted">
        Track evidence changes for this token and selected pool. New serious findings and changed
        controls always trigger alerts.
      </p>
      <form onSubmit={(e) => void submit(e)} className="settings-form">
        <label>
          Check interval
          <select value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
            <option value={5}>Every 5 minutes</option>
            <option value={15}>Every 15 minutes</option>
            <option value={60}>Every hour</option>
            <option value={1440}>Every day</option>
          </select>
        </label>
        <label>
          Alert when observed tax rises to (%)
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            required
            value={tax}
            onChange={(e) => setTax(Number(e.target.value))}
          />
        </label>
        <label>
          Alert on liquidity reduction (%)
          <input
            type="number"
            min="1"
            max="100"
            required
            value={drop}
            onChange={(e) => setDrop(Number(e.target.value))}
          />
        </label>
        {error && (
          <p className="text-high" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? <IconLoader2 className="spin" size={18} /> : <IconStar size={19} />}Save watch
        </button>
      </form>
    </Modal>
  );
}

export function SettingsDialog({
  current,
  connected,
  close,
  updated,
  cleared,
}: {
  current: Preferences | null;
  connected: boolean;
  close: () => void;
  updated: (p: Preferences) => void;
  cleared: () => void;
}) {
  const [url, setUrl] = useState(current?.apiUrl || ''),
    [auto, setAuto] = useState(current?.autoDetect || false),
    [notifications, setNotifications] = useState(current?.notifications || false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [reconnect, setReconnect] = useState(false);
  useEffect(() => {
    void preferences().then((p) => {
      setUrl(p.apiUrl);
      setAuto(p.autoDetect);
      setNotifications(p.notifications);
    });
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const apiUrl = validateApiUrl(url);
      if (nativeExtension) {
        const origin = new URL(apiUrl);
        if (
          !(await chrome.permissions.request({
            origins: [`${origin.protocol}//${origin.hostname}/*`],
          }))
        )
          throw new Error('Backend host permission was not granted.');
      }
      const p = await preferences();
      const next = {
        ...p,
        apiUrl,
        token: apiUrl === p.apiUrl && !reconnect ? p.token : undefined,
        lastReportId: apiUrl === p.apiUrl && !reconnect ? p.lastReportId : undefined,
        autoDetect: auto,
        notifications,
      };
      await savePreferences(next);
      updated(next);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggleAuto(value: boolean) {
    try {
      if (value && !(await chrome.permissions.request({ origins: SUPPORTED_ORIGINS })))
        throw new Error('Supported-site access was not granted.');
      if (!value) await chrome.permissions.remove({ origins: SUPPORTED_ORIGINS });
      setAuto(value);
      const p = await preferences();
      await savePreferences({ ...p, autoDetect: value });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function toggleNotifications(value: boolean) {
    try {
      if (value && !(await chrome.permissions.request({ permissions: ['notifications'] })))
        throw new Error('Notification permission was not granted.');
      if (!value) await chrome.permissions.remove({ permissions: ['notifications'] });
      setNotifications(value);
      const p = await preferences();
      await savePreferences({ ...p, notifications: value });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function removeData() {
    setBusy(true);
    try {
      await request('/device', 'DELETE');
      const p = await preferences();
      await savePreferences({ ...p, token: undefined, lastReportId: undefined });
      cleared();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Settings" onClose={close}>
      <div className={`connection-state ${connected ? 'online' : ''}`}>
        <IconPlug size={18} />
        {connected ? 'Backend connected' : 'Backend connection pending'}
      </div>
      <form className="settings-form" onSubmit={(e) => void save(e)}>
        <label>
          Backend URL
          <input
            type="url"
            value={url}
            required
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-backend.example"
          />
        </label>
        <label className="toggle-label">
          <span>
            Start a new installation identity
            <small>
              Use if this backend lost your installation token. Earlier private history stays with
              the old identity.
            </small>
          </span>
          <input
            type="checkbox"
            checked={reconnect}
            onChange={(e) => setReconnect(e.target.checked)}
          />
        </label>
        <p className="muted small">
          Your selected network, token address, and pool are sent here. Switching backend creates a
          separate private installation.
        </p>
        <label className="toggle-label">
          <span>
            Detect supported pages
            <small>
              Ethereum/Base explorers, DEX Screener, and Uniswap. Detection suggests a token; you
              choose when to scan.
            </small>
          </span>
          <input
            type="checkbox"
            checked={auto}
            disabled={!nativeExtension}
            onChange={(e) => void toggleAuto(e.target.checked)}
          />
        </label>
        <label className="toggle-label">
          <span>
            Desktop change alerts<small>Notifications for watched token changes.</small>
          </span>
          <input
            type="checkbox"
            checked={notifications}
            disabled={!nativeExtension}
            onChange={(e) => void toggleNotifications(e.target.checked)}
          />
        </label>
        {!nativeExtension && (
          <p className="muted small">
            Site detection and desktop notifications are available in the installed Chrome
            extension.
          </p>
        )}
        {error && (
          <p role="alert" className="text-high">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? <IconLoader2 className="spin" size={18} /> : <IconCheck size={18} />}Save settings
        </button>
      </form>
      <section className="privacy-section">
        <h3>Your data</h3>
        <p>
          Reports, watches, and alerts use a random installation identity. No wallet connection,
          transaction signing, email address, or general browsing history is required.
        </p>
        <Link href="privacy.html" className="text-button">
          Privacy disclosure
          <IconExternalLink size={14} />
        </Link>
        {confirmDelete ? (
          <div className="delete-confirm">
            <p>
              Delete this installation’s stored report access, watchlist, and alerts? This cannot be
              undone.
            </p>
            <button className="danger-button" disabled={busy} onClick={() => void removeData()}>
              Delete my data
            </button>
            <button className="text-button" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="text-button delete-link" onClick={() => setConfirmDelete(true)}>
            <IconTrash size={14} />
            Delete installation data
          </button>
        )}
      </section>
      <p className="muted small">Coinchecker 1.0.0 · Creator: Darkartt</p>
    </Modal>
  );
}
