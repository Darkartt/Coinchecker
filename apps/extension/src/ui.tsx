import { useEffect, useRef, type ReactNode } from 'react';
import { IconX, IconCurrencyEthereum, IconCircleMinus } from '@tabler/icons-react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ChainId, Report } from '@coinchecker/shared';
export const money = (value: number | null | undefined) =>
  value === null || value === undefined
    ? 'Unknown'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: value < 1 ? 6 : 2,
        notation: value >= 100000 ? 'compact' : 'standard',
      }).format(value);
export const date = (value: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : 'Timestamp unavailable';
export const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
export const formatValue = (value: unknown) =>
  value === null || value === undefined
    ? 'Unknown'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
export function NetworkIcon({ chain }: { chain: ChainId }) {
  return (
    <img
      className="network-icon"
      src={`assets/${chain === '1' ? 'ethereum' : 'base'}-mark.png`}
      width={24}
      height={24}
      alt=""
    />
  );
}
export function Link({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog">
          <IconX size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Metric({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change?: number | null;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {change !== null && change !== undefined && (
        <small className={change < 0 ? 'negative' : 'positive'}>
          {change < 0 ? '−' : '+'}
          {Math.abs(change).toFixed(1)}% <span>(24h)</span>
        </small>
      )}
    </div>
  );
}
export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
export function Chart({ report, compact = false }: { report: Report; compact?: boolean }) {
  const points = report.project.prices.map(([time, price]) => ({ time, price }));
  if (points.length < 2)
    return compact ? null : <p className="muted">Historical price data was not returned.</p>;
  return (
    <div className={compact ? 'sparkline' : 'price-chart'} aria-label="Historical USD price trend">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={
            compact
              ? { top: 3, bottom: 3, left: 0, right: 0 }
              : { top: 14, bottom: 8, left: 0, right: 14 }
          }
        >
          <YAxis
            domain={['auto', 'auto']}
            hide={compact}
            tickFormatter={(n) => money(n)}
            tick={{ fill: '#a4acb8', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          {!compact && (
            <>
              <XAxis
                dataKey="time"
                tickFormatter={(n) =>
                  new Date(n).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                }
                tick={{ fill: '#a4acb8', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: '#20272e',
                  border: '1px solid #36404a',
                  borderRadius: 8,
                  color: '#fff',
                }}
                labelFormatter={(n) => new Date(Number(n)).toLocaleString()}
                formatter={(n) => money(Number(n))}
              />
            </>
          )}
          <Line
            type="linear"
            dataKey="price"
            stroke={(report.selectedPair?.priceChange24h ?? 0) < 0 ? '#ff7364' : '#ffca61'}
            strokeWidth={1.8}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
