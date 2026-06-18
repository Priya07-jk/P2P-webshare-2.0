import { useCallback, useState } from 'react';

const FILE_TYPE_ICONS = {
  'image':       '🖼️',
  'video':       '🎬',
  'audio':       '🎵',
  'application/pdf': '📄',
  'text':        '📝',
  'application/zip': '🗜️',
  'application/x-zip': '🗜️',
  'default':     '📁',
};

function getFileIcon(type) {
  if (!type) return FILE_TYPE_ICONS.default;
  for (const [key, icon] of Object.entries(FILE_TYPE_ICONS)) {
    if (type.startsWith(key) || type === key) return icon;
  }
  return FILE_TYPE_ICONS.default;
}

function getFileColor(type) {
  if (!type) return '#6366f1';
  if (type.startsWith('image')) return '#ec4899';
  if (type.startsWith('video')) return '#8b5cf6';
  if (type.startsWith('audio')) return '#f59e0b';
  if (type.includes('pdf'))    return '#ef4444';
  if (type.startsWith('text')) return '#10b981';
  if (type.includes('zip'))    return '#f97316';
  return '#6366f1';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * DropZone — drag-and-drop / click file picker.
 * Validates file size and shows a preview card once selected.
 */
export default function DropZone({ onFile, disabled }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError]       = useState('');

  const processFile = useCallback((file) => {
    setError('');
    if (!file) return;
    // Warn but don't block for large files (OPFS handles them)
    if (file.size > 2 * 1024 * 1024 * 1024) {
      setError('File too large (max 2 GB).');
      return;
    }
    onFile(file);
  }, [onFile]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = ()  => setDragging(false);

  const onInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  return (
    <div>
      <label
        className={`drop-zone flex flex-col items-center justify-center p-12 text-center cursor-pointer select-none
          ${dragging ? 'drag-over' : ''}
          ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}
        `}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        style={{ minHeight: 260 }}
      >
        {/* Upload Icon */}
        <div
          className="animate-float mb-6"
          style={{
            width: 80, height: 80,
            borderRadius: 20,
            background: 'rgba(99,102,241,0.12)',
            border: '1px solid rgba(99,102,241,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>

        <p className="text-lg font-semibold text-white mb-2">
          {dragging ? 'Drop it!' : 'Drop your file here'}
        </p>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          or <span className="text-indigo-400 font-medium">click to browse</span>
        </p>
        <div
          className="flex items-center gap-2 px-4 py-2 rounded-full text-xs"
          style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}
        >
          <span>✅ End-to-End Encrypted</span>
          <span>•</span>
          <span>🔒 Zero-Knowledge</span>
          <span>•</span>
          <span>⚡ Direct P2P</span>
        </div>

        <input
          type="file"
          className="hidden"
          onChange={onInputChange}
          disabled={disabled}
          id="file-input"
        />
      </label>

      {error && (
        <div
          className="mt-3 px-4 py-3 rounded-xl text-sm animate-fade-in"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
        >
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}

/**
 * FileCard — displays selected file info.
 */
export function FileCard({ file }) {
  const icon  = getFileIcon(file.type);
  const color = getFileColor(file.type);

  return (
    <div
      className="glass-card-sm flex items-center gap-4 p-4 animate-scale-in"
    >
      <div
        className="file-icon"
        style={{ background: `${color}22`, border: `1px solid ${color}44` }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-white truncate text-sm">{file.name}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          {formatBytes(file.size)}
          {file.size > 50 * 1024 * 1024 && (
            <span className="ml-2 text-amber-400">· OPFS mode</span>
          )}
        </p>
      </div>
      <div
        className="px-2 py-1 rounded-lg text-xs mono"
        style={{ background: `${color}15`, color }}
      >
        {file.type?.split('/')[1]?.toUpperCase() || 'FILE'}
      </div>
    </div>
  );
}
