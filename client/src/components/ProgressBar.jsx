import { formatBytes, formatSpeed, formatETA } from '../utils/chunker.js';

const STATUS_LABELS = {
  idle:         'Idle',
  waiting:      'Waiting for Receiver',
  connecting:   'Connecting…',
  connected:    'Connected',
  transferring: 'Transferring',
  done:         'Complete',
  error:        'Error',
  disconnected: 'Disconnected',
};

/**
 * ConnectionStatus — animated badge showing current connection state.
 */
export function ConnectionStatus({ status }) {
  return (
    <div className={`status-badge ${status}`}>
      <span className={`status-dot ${status}`} />
      {STATUS_LABELS[status] || status}
    </div>
  );
}

/**
 * ProgressBar — shows transfer progress with shimmer, speed, and ETA.
 */
export function ProgressBar({ progress, isSender = true }) {
  const {
    percent = 0, speed = 0, eta = 0,
    chunkIndex = 0, totalChunks = 0,
    fileName, fileSize, fileType,
  } = progress || {};

  const pct = Math.min(100, Math.round(percent * 100));

  return (
    <div className="space-y-4 animate-fade-in">
      {/* File name if receiver */}
      {!isSender && fileName && (
        <div className="flex items-center gap-3">
          <div style={{ fontSize: 22 }}>📥</div>
          <div>
            <p className="font-semibold text-white text-sm truncate">{fileName}</p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {formatBytes(fileSize)}
            </p>
          </div>
        </div>
      )}

      {/* Percentage row */}
      <div className="flex justify-between items-end">
        <span className="text-3xl font-bold gradient-text">{pct}%</span>
        <div className="text-right space-y-0.5">
          <p className="text-sm font-semibold" style={{ color: 'var(--cyan)' }}>
            {formatSpeed(speed)}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            ETA: {formatETA(eta)}
          </p>
        </div>
      </div>

      {/* Track */}
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Chunk counter */}
      <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
        Chunk {chunkIndex.toLocaleString()} / {totalChunks.toLocaleString()}
      </p>
    </div>
  );
}

/**
 * TransferStats — compact stats row shown during/after transfer.
 */
export function TransferStats({ speed, elapsed, totalSize }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {[
        { label: 'Speed',     value: formatSpeed(speed) },
        { label: 'Elapsed',   value: `${Math.round(elapsed)}s` },
        { label: 'Total',     value: formatBytes(totalSize) },
      ].map(({ label, value }) => (
        <div
          key={label}
          className="glass-card-sm p-3 text-center"
        >
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
          <p className="font-semibold text-sm gradient-text">{value}</p>
        </div>
      ))}
    </div>
  );
}
