import { useState, useEffect } from 'react';
import {
  IconSettings,
  IconSearch,
  IconX,
  IconExternalLink,
  IconStar,
  IconChevronRight,
  IconInfoCircle,
  IconLoader2,
  IconBell,
  IconTrash,
  IconRefresh,
  IconCheck,
  IconShieldSearch,
  IconEye,
} from '@tabler/icons-react';
import {
  scanSchema,
  NETWORKS,
  VERDICT_LABELS,
  type ChainId,
  type Report,
  type Watch,
  type Alert,
  type ScanInput,
} from '@coinchecker/shared';
import { api, preferences, savePreferences, nativeExtension, type Preferences } from './client';
import type { Detection } from './detection';
import { SAMPLE_REPORT } from './sample';
import { ReportView } from './ReportView';
import { WatchDialog, SettingsDialog } from './Dialogs';
import { NetworkIcon, short, date, formatValue } from './ui';

export function App() {
  const initialSample = new URLSearchParams(location.search).has('design');
  const [report, setReport] = useState<Report | null>(initialSample ? SAMPLE_REPORT : null),
    [sample, setSample] = useState(initialSample),
    [chainId, setChainId] = useState<ChainId>('8453'),
    [address, setAddress] = useState(initialSample ? SAMPLE_REPORT.address : ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [topTab, setTopTab] = useState<'scan' | 'watchlist' | 'alerts'>('scan'),
    [settingsOpen, setSettingsOpen] = useState(false),
    [watchOpen, setWatchOpen] = useState(false),
    [watches, setWatches] = useState<Watch[]>([]),
    [alerts, setAlerts] = useState<Alert[]>([]),
    [connected, setConnected] = useState(false),
    [detected, setDetected] = useState<Detection | null>(null),
    [prefs, setPrefs] = useState<Preferences | null>(null);
  const currentWatch = report
    ? watches.find(
        (w) =>
          w.chainId === report.chainId &&
          w.address.toLowerCase() === report.address.toLowerCase() &&
          (w.pairAddress || '').toLowerCase() === (report.pairAddress || '').toLowerCase(),
      )
    : null;
  async function refreshPrivate() {
    const [w, a] = await Promise.all([api.watches(), api.alerts()]);
    setWatches(w);
    setAlerts(a);
    setConnected(true);
  }
  useEffect(() => {
    let active = true;
    void preferences().then((p) => {
      if (active) setPrefs(p);
    });
    if (!initialSample)
      void (async () => {
        try {
          await refreshPrivate();
          const p = await preferences();
          if (p.lastReportId) {
            const r = await api.report(p.lastReportId);
            if (active) {
              setReport(r);
              setChainId(r.chainId);
              setAddress(r.address);
            }
          }
        } catch (e) {
          if (active) setError((e as Error).message);
        }
      })();
    const timer = setInterval(() => {
      if (active && !initialSample) void refreshPrivate().catch(() => setConnected(false));
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!nativeExtension) return;
    const listener = (updates: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && updates.detectedToken)
        setDetected((updates.detectedToken.newValue as Detection | undefined) || null);
    };
    chrome.storage.onChanged.addListener(listener);
    void chrome.storage.session.get('detectedToken').then((v) => {
      if (v.detectedToken) setDetected(v.detectedToken as Detection);
    });
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(id);
  }, [notice]);
  async function scan(input?: ScanInput) {
    const parsed = scanSchema.safeParse(input || { chainId, address });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(' '));
      return;
    }
    setBusy(true);
    setError('');
    setTopTab('scan');
    try {
      const r = await api.scan(parsed.data);
      setReport(r);
      setSample(false);
      setChainId(r.chainId);
      setAddress(r.address);
      setConnected(true);
      const p = await preferences();
      const next = { ...p, lastReportId: r.id };
      await savePreferences(next);
      setPrefs(next);
      void refreshPrivate().catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function detect() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'detect-token' });
      if (!response?.detection) {
        setNotice(
          'No supported token URL was found in this tab. Paste the contract address to scan.',
        );
        return;
      }
      setDetected(response.detection);
    } catch {
      setNotice('Open the panel from the toolbar on a supported token page, or paste an address.');
    }
  }
  async function useDetected(value: Detection) {
    setBusy(true);
    try {
      const input =
        value.kind === 'pool'
          ? await api.resolve(value.chainId, value.address)
          : { chainId: value.chainId, address: value.address };
      setDetected(null);
      setAddress(input.address);
      setChainId(input.chainId);
      setBusy(false);
      await scan(input);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  function openReport(r: Report) {
    setSample(false);
    setReport(r);
    setAddress(r.address);
    setChainId(r.chainId);
    setTopTab('scan');
  }
  async function openWatch(w: Watch) {
    if (w.lastReport) openReport(w.lastReport);
    else
      await scan({
        chainId: w.chainId,
        address: w.address as ScanInput['address'],
        pairAddress: w.pairAddress as ScanInput['pairAddress'],
      });
  }
  function showSample() {
    setSample(true);
    setReport(SAMPLE_REPORT);
    setAddress(SAMPLE_REPORT.address);
    setChainId('8453');
    setTopTab('scan');
    setError('');
  }
  const unread = alerts.filter((a) => !a.read).length;
  return (
    <main className="app">
      <header className="header">
        <div className="brand">
          <img src="assets/coinchecker-mark.png" width="29" height="29" alt="" />
          <span>Coinchecker</span>
          {sample && (
            <button
              className="sample-tag"
              title="Fictional sample report. No token was scanned."
              aria-label="Exit sample"
              onClick={() => {
                setSample(false);
                setReport(null);
                setAddress('');
              }}
            >
              <IconEye size={12} />
              Sample
              <IconX size={12} />
            </button>
          )}
        </div>
        <div className="header-actions">
          <button
            className="icon-button alert-button"
            onClick={() => {
              setTopTab(topTab === 'alerts' ? 'scan' : 'alerts');
              void refreshPrivate().catch((e) => setError(e.message));
            }}
            aria-label={`Alerts${unread ? `, ${unread} unread` : ''}`}
          >
            <IconBell size={21} />
            {unread > 0 && <span className="count">{unread}</span>}
          </button>
          <button
            className="icon-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            <IconSettings size={23} />
          </button>
        </div>
      </header>
      <nav className="top-tabs" aria-label="Main navigation">
        <button className={topTab === 'scan' ? 'active' : ''} onClick={() => setTopTab('scan')}>
          Scan
        </button>
        <button
          className={topTab === 'watchlist' ? 'active' : ''}
          onClick={() => {
            setTopTab('watchlist');
            void refreshPrivate().catch((e) => setError(e.message));
          }}
        >
          Watchlist{watches.length > 0 && <span className="tab-count">{watches.length}</span>}
        </button>
      </nav>
      {error && (
        <div className="error-banner" role="alert">
          <IconInfoCircle size={18} />
          <span>
            {error}
            {report && !sample && ' Showing the earlier report.'}
          </span>
          <button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error">
            <IconX size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {topTab === 'scan' && (
        <>
          <div className="networks" role="group" aria-label="Select network">
            {(Object.keys(NETWORKS) as ChainId[]).map((id) => (
              <button
                key={id}
                disabled={busy}
                onClick={() => setChainId(id)}
                className={chainId === id ? 'selected' : ''}
                aria-pressed={chainId === id}
              >
                <NetworkIcon chain={id} />
                {NETWORKS[id].name}
              </button>
            ))}
          </div>
          <form
            className="scan-form"
            onSubmit={(e) => {
              e.preventDefault();
              void scan();
            }}
          >
            <label className="sr-only" htmlFor="token-address">
              Token contract address
            </label>
            <div className="address-field">
              <input
                id="token-address"
                placeholder="0x… token contract address"
                autoComplete="off"
                spellCheck={false}
                value={address}
                disabled={busy}
                onChange={(e) => setAddress(e.target.value)}
              />
              {address && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setAddress('')}
                  aria-label="Clear address"
                  disabled={busy}
                >
                  <IconX size={17} />
                </button>
              )}
            </div>
            <button className="scan-button" disabled={busy} aria-label="Scan token">
              {busy ? <IconLoader2 className="spin" size={24} /> : <IconSearch size={24} />}
            </button>
          </form>
          {nativeExtension && (
            <button
              className="text-button detect-button"
              onClick={() => void detect()}
              disabled={busy}
            >
              Use token from this tab
              <IconExternalLink size={13} />
            </button>
          )}
          {detected && (
            <div className="detected">
              <span>
                {NETWORKS[detected.chainId].name} {detected.kind} found on {detected.source}
                <small>{short(detected.address)}</small>
              </span>
              <button
                className="small-button"
                disabled={busy}
                onClick={() => void useDetected(detected)}
              >
                Check
              </button>
              <button
                className="icon-button"
                onClick={() => setDetected(null)}
                aria-label="Dismiss detected token"
              >
                <IconX size={17} />
              </button>
            </div>
          )}
          {busy && (
            <div className="scan-progress" role="status">
              <IconLoader2 className="spin" size={18} />
              <span>
                Checking providers and recording evidence…
                <small>Some on-chain checks take up to a minute.</small>
              </span>
            </div>
          )}
          {!report && !busy && (
            <section className="empty-state">
              <IconShieldSearch size={44} stroke={1.35} />
              <h1>
                Understand a token.
                <br />
                See the evidence.
              </h1>
              <p>Check risks, market context, and what changed before interacting.</p>
              <button
                className="primary"
                onClick={() =>
                  void scan({
                    chainId: '8453',
                    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                  })
                }
              >
                Check USDC on Base
                <IconChevronRight size={18} />
              </button>
              <button className="text-button sample-link" onClick={showSample}>
                Explore a sample report
              </button>
              <p className="privacy-hint">
                Read-only. No wallet connection.
                <br />
                Only your selected network and address are sent.
              </p>
            </section>
          )}
          {report && (
            <ReportView
              report={report}
              sample={sample}
              busy={busy}
              watch={currentWatch || null}
              scan={scan}
              onWatch={() => setWatchOpen(true)}
              onUnwatch={() => {
                if (currentWatch)
                  void api
                    .unwatch(currentWatch.id)
                    .then(refreshPrivate)
                    .catch((e) => setError(e.message));
              }}
              onReport={openReport}
              notify={setNotice}
            />
          )}
        </>
      )}
      {topTab === 'watchlist' && (
        <section className="list-view">
          <div className="section-heading">
            <h1>Your watchlist</h1>
            <span className="muted">{watches.length} / 50</span>
          </div>
          <p className="muted">The backend checks watched tokens even when the panel is closed.</p>
          {watches.length ? (
            watches.map((w) => (
              <article className="watch-row" key={w.id}>
                <button className="watch-main" onClick={() => void openWatch(w)}>
                  <strong>{w.label}</strong>
                  <span>
                    {NETWORKS[w.chainId].name} · {short(w.address)}
                  </span>
                  <small>
                    {w.pairAddress ? `Pool ${short(w.pairAddress)}` : 'Automatic pool selection'}
                  </small>
                  <small className={w.lastReport ? `text-${w.lastReport.verdict}` : 'muted'}>
                    {w.lastReport ? VERDICT_LABELS[w.lastReport.verdict] : 'First check pending'}
                  </small>
                  <small>Next check {date(w.nextCheckAt)}</small>
                  {w.lastError && <small className="text-caution">{w.lastError}</small>}
                </button>
                <button
                  className="icon-button"
                  onClick={() =>
                    void api
                      .unwatch(w.id)
                      .then(refreshPrivate)
                      .catch((e) => setError(e.message))
                  }
                  aria-label={`Stop watching ${w.label}`}
                >
                  <IconTrash size={18} />
                </button>
              </article>
            ))
          ) : (
            <div className="list-empty">
              <IconStar size={34} />
              <h2>Keep an eye on changes</h2>
              <p>
                Scan a token, then add it to your watchlist to track new findings and meaningful
                changes.
              </p>
              <button className="primary" onClick={() => setTopTab('scan')}>
                Scan a token
                <IconChevronRight size={18} />
              </button>
            </div>
          )}
        </section>
      )}
      {topTab === 'alerts' && (
        <section className="list-view">
          <div className="section-heading">
            <h1>Change alerts</h1>
            <button
              className="icon-button"
              onClick={() => void refreshPrivate().catch((e) => setError(e.message))}
              aria-label="Refresh alerts"
            >
              <IconRefresh size={18} />
            </button>
          </div>
          <p className="muted">Meaningful changes to watched tokens, with recorded evidence.</p>
          {alerts.length ? (
            alerts.map((a) => (
              <article key={a.id} className={`alert-row ${a.read ? 'read' : ''}`}>
                <h3>{a.title}</h3>
                <small>{date(a.createdAt)}</small>
                {a.changes.map((c, i) => (
                  <p key={i}>
                    {c.title}: {formatValue(c.before)} → {formatValue(c.after)}
                  </p>
                ))}
                <div className="alert-actions">
                  <button
                    className="text-button"
                    onClick={() =>
                      void api
                        .report(a.reportId)
                        .then(openReport)
                        .catch((e) => setError(e.message))
                    }
                  >
                    View report
                    <IconChevronRight size={14} />
                  </button>
                  {!a.read && (
                    <button
                      className="text-button"
                      onClick={() =>
                        void api
                          .readAlert(a.id)
                          .then(refreshPrivate)
                          .catch((e) => setError(e.message))
                      }
                    >
                      Mark read
                      <IconCheck size={14} />
                    </button>
                  )}
                </div>
              </article>
            ))
          ) : (
            <div className="list-empty">
              <IconBell size={34} />
              <h2>No changes to review</h2>
              <p>
                Alerts appear for new findings, elevated taxes, reduced liquidity, changed controls,
                or lost coverage.
              </p>
            </div>
          )}
        </section>
      )}
      {watchOpen && report && (
        <WatchDialog
          report={report}
          existing={currentWatch || null}
          close={() => setWatchOpen(false)}
          saved={() => {
            setWatchOpen(false);
            void refreshPrivate();
            setNotice('Watch saved. Change monitoring runs on the backend.');
          }}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          current={prefs}
          connected={connected}
          close={() => setSettingsOpen(false)}
          updated={(p) => {
            setPrefs(p);
            if (p.apiUrl !== prefs?.apiUrl || !p.token) {
              setReport(null);
              setWatches([]);
              setAlerts([]);
            }
            setNotice('Settings saved.');
            void refreshPrivate().catch((e) => setError(e.message));
          }}
          cleared={() => {
            setReport(null);
            setWatches([]);
            setAlerts([]);
            setConnected(false);
            setAddress('');
            setSettingsOpen(false);
            setNotice('Installation data deleted. A new identity is created on your next scan.');
          }}
        />
      )}
    </main>
  );
}
