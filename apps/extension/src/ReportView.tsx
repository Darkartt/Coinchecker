import { useState, useEffect } from 'react';
import {
  IconCopy,
  IconExternalLink,
  IconAlertTriangleFilled,
  IconAlertCircleFilled,
  IconChevronRight,
  IconStar,
  IconStarFilled,
  IconFileDescription,
  IconDatabase,
  IconClock,
  IconInfoCircle,
  IconRefresh,
  IconDownload,
  IconCheck,
  IconChevronDown,
  IconShieldSearch,
  IconCoin,
} from '@tabler/icons-react';
import {
  NETWORKS,
  VERDICT_LABELS,
  SOURCE_LABELS,
  explorerLink,
  compareReports,
  type Report,
  type Watch,
  type Finding,
  type Change,
  type ScanInput,
} from '@coinchecker/shared';
import { api } from './client';
import {
  Modal,
  Link,
  NetworkIcon,
  Metric,
  Detail,
  Chart,
  money,
  date,
  short,
  formatValue,
} from './ui';

export function ReportView({
  report: r,
  sample,
  busy,
  watch,
  scan,
  onWatch,
  onUnwatch,
  onReport,
  notify,
}: {
  report: Report;
  sample: boolean;
  busy: boolean;
  watch: Watch | null;
  scan: (input: ScanInput) => Promise<void>;
  onWatch: () => void;
  onUnwatch: () => void;
  onReport: (r: Report) => void;
  notify: (s: string) => void;
}) {
  const [logoFailed, setLogoFailed] = useState(false),
    [tab, setTab] = useState<'risks' | 'market' | 'history'>('risks'),
    [expanded, setExpanded] = useState<string | null>(null),
    [evidence, setEvidence] = useState(false),
    [copied, setCopied] = useState(false),
    [history, setHistory] = useState<Report[]>([]),
    [timelineLimit, setTimelineLimit] = useState(10),
    [previous, setPrevious] = useState(''),
    [changes, setChanges] = useState<Change[] | null>(null);
  useEffect(() => {
    setLogoFailed(false);
    setExpanded(null);
    setHistory([]);
    setPrevious('');
    setChanges(null);
    setTimelineLimit(10);
    if (sample) {
      setHistory([]);
      return;
    }
    let active = true;
    void api
      .history({
        chainId: r.chainId,
        address: r.address as ScanInput['address'],
        pairAddress: r.pairAddress as ScanInput['pairAddress'],
      })
      .then((rows) => {
        if (active) {
          setHistory(rows);
          const old = rows.find((p) => p.checkedAt < r.checkedAt);
          setPrevious(old?.id || '');
          setChanges(old ? compareReports(old, r) : null);
        }
      })
      .catch((e) => notify(e.message));
    return () => {
      active = false;
    };
  }, [r.id, sample]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(r.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      notify('Clipboard access was unavailable. The full address is in the evidence view.');
    }
  }
  function exportReport() {
    const blob = new Blob([JSON.stringify({ sample, report: r }, null, 2)], {
        type: 'application/json',
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = sample
      ? 'coinchecker-sample.json'
      : `coinchecker-${r.chainId}-${r.address}-${r.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const prominent = ['critical', 'high', 'caution']
    .map((s) => r.findings.find((f) => f.severity === s))
    .find(Boolean);
  return (
    <div className={busy ? 'report busy-report' : 'report'}>
      <section className="token-identity">
        <div className="token-avatar">
          {sample ? (
            <img src="assets/sample-exm.png" width="68" height="68" alt="Example token" />
          ) : r.project.logo && !logoFailed ? (
            <img
              src={r.project.logo}
              width="68"
              height="68"
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <IconCoin size={47} stroke={1.15} />
          )}
        </div>
        <div className="token-details">
          <h1 title={r.name}>{r.name}</h1>
          <div className="ticker">
            {r.symbol}
            <span>·</span>
            <NetworkIcon chain={r.chainId} />
            {NETWORKS[r.chainId].name}
          </div>
          <div className="contract-address">
            <button title={r.address} className="address-copy" onClick={() => void copy()}>
              {short(r.address)}
            </button>
            <button
              className="icon-button"
              onClick={() => void copy()}
              aria-label="Copy full contract address"
            >
              {copied ? <IconCheck size={20} /> : <IconCopy size={20} />}
            </button>
            {sample && (
              <button
                className="icon-button"
                disabled
                aria-label="Fictional contract has no explorer page"
              >
                <IconExternalLink size={20} />
              </button>
            )}
            {!sample && (
              <Link href={explorerLink(r.chainId, 'address', r.address)} className="icon-button">
                <span className="sr-only">View contract on explorer</span>
                <IconExternalLink size={20} />
              </Link>
            )}
          </div>
        </div>
      </section>
      <section className={`assessment assessment-${r.verdict}`}>
        <div className="assessment-heading">
          {['critical', 'high'].includes(r.verdict) ? (
            <IconAlertTriangleFilled size={43} />
          ) : r.verdict === 'caution' ? (
            <IconAlertCircleFilled size={41} />
          ) : (
            <IconShieldSearch size={40} />
          )}
          <h2>{VERDICT_LABELS[r.verdict]}</h2>
        </div>
        <h3>
          {prominent?.title ||
            (r.verdict === 'no_major_issues'
              ? 'In the checks completed'
              : 'Some essential checks are unavailable')}
        </h3>
        <p>
          {sample
            ? 'Selling restrictions are reported in this fictional example. Inspect the evidence to understand the finding.'
            : prominent?.explanation ||
              (r.verdict === 'no_major_issues'
                ? 'No major issues were detected in the checks completed. Coverage limitations still apply.'
                : 'There is not enough evidence for a complete assessment. Review provider coverage and unknown fields.')}
        </p>
        <button className="primary evidence-button" onClick={() => setEvidence(true)}>
          <IconFileDescription size={23} />
          Inspect evidence
          <IconChevronRight size={19} />
        </button>
      </section>
      <nav className="report-tabs" aria-label="Report sections">
        {(['risks', 'market', 'history'] as const).map((t) => (
          <button className={tab === t ? 'active' : ''} key={t} onClick={() => setTab(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      {tab === 'risks' && (
        <section className="findings" aria-label="Risk findings">
          {r.findings.length ? (
            r.findings.map((f) => (
              <FindingRow
                key={f.id}
                finding={f}
                report={r}
                expanded={expanded === f.id}
                toggle={() => setExpanded(expanded === f.id ? null : f.id)}
                openEvidence={() => setEvidence(true)}
              />
            ))
          ) : (
            <div className="no-findings">
              <IconInfoCircle size={19} />
              <p>
                {r.verdict === 'insufficient_data'
                  ? 'No substantiated findings were returned. Unknown checks are listed in the evidence view.'
                  : 'No major findings in the completed checks. This is an observation, not a safety guarantee.'}
              </p>
            </div>
          )}
        </section>
      )}
      {tab === 'market' && (
        <section className="market-view">
          <label htmlFor="pool">Pool analysed</label>
          <select
            id="pool"
            value={r.pairAddress || ''}
            disabled={busy || sample}
            onChange={(e) =>
              void scan({
                chainId: r.chainId,
                address: r.address as ScanInput['address'],
                pairAddress: (e.target.value || undefined) as ScanInput['pairAddress'],
              })
            }
          >
            <option value="">Automatic · Most indexed liquidity</option>
            {r.pairs.map((p) => (
              <option value={p.address} key={p.address}>
                {p.label} · {money(p.liquidityUsd)}
              </option>
            ))}
          </select>
          {r.selectedPair ? (
            <>
              <div className="market-grid">
                <Metric label="Price (USD)" value={money(r.selectedPair.priceUsd)} />
                <Metric label="Pool liquidity" value={money(r.selectedPair.liquidityUsd)} />
                <Metric label="24h volume" value={money(r.selectedPair.volume24h)} />
                <Metric label="Market cap" value={money(r.selectedPair.marketCap)} />
                <Metric label="FDV" value={money(r.selectedPair.fdv)} />
                <Metric
                  label="Holders"
                  value={r.metrics.holderCount?.toLocaleString() || 'Unknown'}
                />
              </div>
              <Chart report={r} />
              <p className="muted small">Price history: CoinGecko. Pool data: DEX Screener.</p>
              <Link href={r.selectedPair.url} className="text-button">
                View selected pool
                <IconExternalLink size={15} />
              </Link>
            </>
          ) : (
            <p className="muted">
              No indexed pool was returned. Missing market data is not a passed security check.
            </p>
          )}
          <div className="detail-list">
            <Detail
              label="Observed buy tax"
              value={r.metrics.buyTax === null ? 'Unknown' : `${r.metrics.buyTax.toFixed(2)}%`}
            />
            <Detail
              label="Observed sell tax"
              value={r.metrics.sellTax === null ? 'Unknown' : `${r.metrics.sellTax.toFixed(2)}%`}
            />
            <Detail
              label="Liquidity lock"
              value={
                r.metrics.liquidityLockedPercent === null
                  ? 'Not established'
                  : `${r.metrics.liquidityLockedPercent.toFixed(1)}% reported locked`
              }
            />
            <Detail
              label="Token deployed"
              value={r.contract.deployedAt ? date(r.contract.deployedAt) : 'Unknown'}
            />
            <Detail
              label="Pool created"
              value={r.selectedPair?.createdAt ? date(r.selectedPair.createdAt) : 'Unknown'}
            />
          </div>
          {r.project.description && (
            <div className="project">
              <h3>Project background</h3>
              <p>{r.project.description}</p>
              <small>{r.project.provenance}</small>
              {r.project.websites.map((u, i) => (
                <Link href={u} key={u} className="text-button">
                  Project website {i + 1}
                  <IconExternalLink size={14} />
                </Link>
              ))}
              {r.project.repositories.map((u, i) => (
                <Link href={u} key={u} className="text-button">
                  Repository {i + 1}
                  <IconExternalLink size={14} />
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
      {tab === 'history' && (
        <section className="history-view">
          <h3>What changed?</h3>
          {history.some((p) => p.checkedAt < r.checkedAt) ? (
            <>
              <label htmlFor="previous-report">Compare with an earlier scan</label>
              <select
                id="previous-report"
                value={previous}
                onChange={(e) => {
                  setPrevious(e.target.value);
                  const old = history.find((p) => p.id === e.target.value);
                  setChanges(old ? compareReports(old, r) : null);
                }}
              >
                {history
                  .filter((p) => p.checkedAt < r.checkedAt)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {date(p.checkedAt)}
                    </option>
                  ))}
              </select>
              {changes?.length ? (
                changes.map((c, i) => (
                  <div className="change-row" key={i}>
                    <h4>{c.title}</h4>
                    <p>
                      {formatValue(c.before)} <span>→</span> {formatValue(c.after)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="muted">
                  No comparable changes in the recorded fields. Unknown values are not interpreted
                  as resolved findings.
                </p>
              )}
            </>
          ) : (
            <p className="muted">
              Changes appear after another scan. Earlier data is not reconstructed from the current
              response.
            </p>
          )}
          <h3 className="section-title">On-chain and pool history</h3>
          <p className="muted small">
            {r.historyCoverage.note}
            {r.historyCoverage.fromBlock &&
              ` Checked blocks ${r.historyCoverage.fromBlock}–${r.historyCoverage.toBlock}.`}
          </p>
          {r.history.length ? (
            r.history.slice(0, timelineLimit).map((event) => (
              <article className="timeline-row" key={event.id}>
                <div className="timeline-marker">
                  <IconClock size={16} />
                </div>
                <div>
                  <span className="provenance">
                    {event.kind === 'onchain'
                      ? 'Verified on-chain event'
                      : 'Third-party market record'}
                  </span>
                  <h4>{event.title}</h4>
                  <small>
                    {date(event.timestamp)}
                    {event.blockNumber && ` · Block ${event.blockNumber}`}
                  </small>
                  <p>{event.description}</p>
                  {event.url && (
                    <Link href={event.url} className="text-button">
                      View evidence
                      <IconExternalLink size={13} />
                    </Link>
                  )}
                </div>
              </article>
            ))
          ) : (
            <p className="muted">No events were established in the indexed range.</p>
          )}
          {r.history.length > timelineLimit && (
            <button className="text-button" onClick={() => setTimelineLimit((n) => n + 10)}>
              Show more events ({r.history.length - timelineLimit} remaining)
            </button>
          )}
          <h3 className="section-title">Your recorded scans</h3>
          {history.map((p) => (
            <button className="history-record" key={p.id} onClick={() => onReport(p)}>
              <span>
                {date(p.checkedAt)}
                <small>{VERDICT_LABELS[p.verdict]}</small>
              </span>
              <IconChevronRight size={17} />
            </button>
          ))}
          {!history.length && (
            <p className="muted">
              {sample ? 'Sample only. No reports are stored.' : 'No earlier stored scans.'}
            </p>
          )}
        </section>
      )}
      {tab === 'risks' && (
        <div className="market-strip">
          <Metric
            label="Price (USD)"
            value={money(r.selectedPair?.priceUsd)}
            change={r.selectedPair?.priceChange24h}
          />
          <Metric label="Liquidity (USD)" value={money(r.selectedPair?.liquidityUsd)} />
          <Chart report={r} compact />
        </div>
      )}
      <footer className="report-footer">
        <div className="coverage-summary">
          <IconDatabase size={23} />
          <div>
            <strong>
              Coverage:{' '}
              <span>{r.coverage.label[0]!.toUpperCase() + r.coverage.label.slice(1)}</span>
            </strong>
            <button className="text-button small" onClick={() => setEvidence(true)}>
              {r.coverage.completed} / {r.coverage.total} sources complete
              <IconInfoCircle size={13} />
            </button>
          </div>
        </div>
        <div className="checked">
          <IconClock size={22} />
          <span>
            Checked {date(r.checkedAt)}
            <small>
              {sample
                ? 'Sample date'
                : Date.now() > Date.parse(r.expiresAt)
                  ? 'Historical snapshot · Refresh to check again'
                  : 'Recorded snapshot'}
            </small>
          </span>
        </div>
      </footer>
      <button
        className="watch-button"
        disabled={busy || sample}
        onClick={watch ? onUnwatch : onWatch}
      >
        {watch ? <IconStarFilled size={23} /> : <IconStar size={23} />}{' '}
        {watch ? 'Watching token' : 'Watch token'}
      </button>
      {!sample && (
        <div className="report-actions">
          {watch && (
            <button className="text-button" disabled={busy} onClick={onWatch}>
              Edit watch
            </button>
          )}
          <button
            className="text-button"
            disabled={busy || sample}
            onClick={() =>
              void scan({
                chainId: r.chainId,
                address: r.address as ScanInput['address'],
                pairAddress: r.pairAddress as ScanInput['pairAddress'],
                refresh: true,
              })
            }
          >
            <IconRefresh size={14} />
            Refresh scan
          </button>
          <button className="text-button" onClick={exportReport}>
            <IconDownload size={14} />
            Export report
          </button>
        </div>
      )}
      <p className="endnote">
        {sample
          ? 'Design preview · Sample data'
          : 'Evidence at a recorded time. Conditions can change.'}
      </p>
      {evidence && (
        <Modal title="Recorded evidence" onClose={() => setEvidence(false)}>
          <div className="evidence-identity">
            <strong>{NETWORKS[r.chainId].name}</strong>
            <code>{r.address}</code>
            <small>
              {date(r.checkedAt)} · Rules {r.rulesVersion}
            </small>
          </div>
          <div className="detail-list">
            <Detail
              label="Source verified"
              value={
                r.contract.verified === null
                  ? 'Unknown'
                  : r.contract.verified
                    ? 'Yes · Separate from an audit'
                    : 'No'
              }
            />
            <Detail label="Audit available" value="Not established" />
            <Detail label="Owner detected" value={r.contract.owner || 'Unknown'} />
            <Detail label="Implementation" value={r.contract.implementation || 'Not established'} />
          </div>
          {r.contract.implementation &&
            !sample &&
            /^0x[0-9a-fA-F]{40}$/.test(r.contract.implementation) && (
              <Link
                href={explorerLink(r.chainId, 'address', r.contract.implementation)}
                className="text-button"
              >
                View implementation
                <IconExternalLink size={15} />
              </Link>
            )}
          <h3 className="section-title">Provider coverage</h3>
          {r.sources.map((s) => (
            <details className="source-detail" key={s.source}>
              <summary>
                <span>{SOURCE_LABELS[s.source]}</span>
                <span className={`source-status ${s.status}`}>
                  {s.status.replaceAll('_', ' ')}
                  <IconChevronDown size={14} />
                </span>
              </summary>
              <p>{s.message || 'Response recorded.'}</p>
              <small>
                {date(s.checkedAt)}
                {s.source === 'rpc' && ` · Block ${r.historyCoverage.toBlock || 'unknown'}`}
              </small>
              <p className="digest">SHA-256: {s.digest}</p>
              <pre>{JSON.stringify(s.data, null, 2).slice(0, 100000)}</pre>
            </details>
          ))}
          {r.evidence.length > 0 && (
            <>
              <h3 className="section-title">Finding references</h3>
              {r.evidence.map((e) => (
                <details className="source-detail" key={e.id}>
                  <summary>
                    {SOURCE_LABELS[e.source]} · {e.field}
                  </summary>
                  <pre>{JSON.stringify(e.value, null, 2)}</pre>
                  <small>
                    {date(e.observedAt)}
                    {e.blockNumber && ` · Block ${e.blockNumber}`}
                  </small>
                </details>
              ))}
            </>
          )}
          <h3 className="section-title">Limitations</h3>
          <ul className="limitations">
            {r.coverage.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <button className="watch-button" onClick={exportReport}>
            <IconDownload size={18} />
            Export full evidence
          </button>
        </Modal>
      )}
    </div>
  );
}
function FindingRow({
  finding: f,
  report,
  expanded,
  toggle,
  openEvidence,
}: {
  finding: Finding;
  report: Report;
  expanded: boolean;
  toggle: () => void;
  openEvidence: () => void;
}) {
  const s = report.evidence.find((e) => f.evidenceIds.includes(e.id))?.source,
    label = {
      critical: 'Critical',
      high: 'High risk',
      caution: 'Caution',
      info: 'Information',
      unknown: 'Unknown',
    };
  return (
    <article className={`finding severity-${f.severity}`}>
      <button className="finding-toggle" onClick={toggle} aria-expanded={expanded}>
        <span className="finding-icon">
          {['critical', 'high'].includes(f.severity) ? (
            <IconAlertTriangleFilled size={26} />
          ) : f.severity === 'caution' ? (
            <IconAlertCircleFilled size={26} />
          ) : (
            <IconInfoCircle size={25} />
          )}
        </span>
        <span className="finding-copy">
          <strong>{f.title}</strong>
          <span>{f.explanation}</span>
          {s && <small>Source: {SOURCE_LABELS[s]}</small>}
        </span>
        <span className={`severity-tag ${f.severity}`}>{label[f.severity]}</span>
        <IconChevronRight size={17} className={expanded ? 'rotated' : ''} />
      </button>
      {expanded && (
        <div className="finding-expanded">
          <p>{f.limitations}</p>
          {f.evidenceIds.map((id) => {
            const e = report.evidence.find((v) => v.id === id);
            return e ? (
              <div className="evidence-ref" key={id}>
                <code>
                  {e.field}: {formatValue(e.value)}
                </code>
                <small>
                  {date(e.observedAt)}
                  {e.blockNumber && ` · Block ${e.blockNumber}`}
                </small>
              </div>
            ) : null;
          })}
          <button className="text-button" onClick={openEvidence}>
            Inspect source response
            <IconChevronRight size={14} />
          </button>
        </div>
      )}
    </article>
  );
}
