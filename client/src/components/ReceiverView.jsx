import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../hooks/useSocket.js';
import { useWebRTC, CONN_STATE } from '../hooks/useWebRTC.js';
import { ConnectionStatus, ProgressBar, TransferStats } from './ProgressBar.jsx';
import { formatBytes } from '../utils/chunker.js';

/**
 * ReceiverView — the receiver's full experience:
 * 1. Join room → wait for offer → connect
 * 2. Receive encrypted chunks → decrypt → verify → auto-download
 * 3. Show hash verification result
 */
export default function ReceiverView({ roomId, keyStr }) {
  const [status,    setStatus]    = useState(CONN_STATE.CONNECTING);
  const [progress,  setProgress]  = useState(null);
  const [fileReady, setFileReady] = useState(null);
  const [error,     setError]     = useState('');
  const [startTime, setStartTime] = useState(null);

  const socket = useSocket();
  const webrtc = useWebRTC({
    onProgress: (p) => {
      if (!startTime && p.percent > 0) setStartTime(Date.now());
      setProgress(p);
    },
    onStatus:          setStatus,
    onFileReady:       setFileReady,
    onError:           (e) => setError(e.message),
    onPeerDisconnected: () => {
      if (status !== CONN_STATE.DONE) {
        setStatus(CONN_STATE.DISCONNECTED);
        setError('Sender disconnected before transfer completed.');
      }
    },
  });

  // ── Initialize: import key + join room + wait for offer ───────────────────
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        await webrtc.initReceiver(keyStr);
        if (cancelled) return; // Prevent StrictMode double-join
        await socket.joinRoom(roomId);
        if (cancelled) return;
        setStatus(CONN_STATE.WAITING);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setStatus(CONN_STATE.ERROR);
        }
      }
    };

    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line

  // ── Handle signals (offer + ICE) from sender ───────────────────────────────
  useEffect(() => {
    const off = socket.onSignal(async ({ signal }) => {
      if (signal.type === 'offer') {
        await webrtc.handleOffer(signal, roomId, socket.sendSignal);
      } else if (signal.type === 'ice-candidate') {
        await webrtc.addIceCandidate(signal.candidate);
      }
    });
    return off;
  }, [socket, webrtc, roomId]);

  // ── Peer disconnected ──────────────────────────────────────────────────────
  useEffect(() => {
    const off = socket.onPeerDisconnected(() => {
      if (status !== CONN_STATE.DONE) {
        setStatus(CONN_STATE.DISCONNECTED);
        setError('The sender closed the connection.');
      }
    });
    return off;
  }, [socket, status]);

  const elapsed = startTime ? (Date.now() - startTime) / 1000 : 0;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-12">

      {/* ── Header ── */}
      <div className="text-center mb-10 animate-slide-up">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div
            style={{
              width: 48, height: 48, borderRadius: 14,
              background: 'linear-gradient(135deg,#22d3ee,#6366f1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 30px rgba(34,211,238,0.4)',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h1 className="text-3xl font-black gradient-text tracking-tight">P2P WebShare</h1>
        </div>
        <p className="text-base max-w-sm" style={{ color: 'var(--text-secondary)' }}>
          Receiving file — direct, encrypted, peer-to-peer.
        </p>
      </div>

      {/* ── Main Card ── */}
      <div className="glass-card w-full max-w-lg p-8 space-y-6 animate-scale-in">

        {/* Status bar */}
        <div className="flex items-center justify-between">
          <ConnectionStatus status={status} />
          <div
            className="px-3 py-1.5 rounded-lg mono text-xs font-medium"
            style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--accent-light)', letterSpacing: '0.1em' }}
          >
            {roomId}
          </div>
        </div>

        <div className="divider" />

        {/* ── Waiting / Connecting ── */}
        {(status === CONN_STATE.WAITING || status === CONN_STATE.CONNECTING) && (
          <div className="text-center py-8 space-y-5 animate-fade-in">
            {/* Animated rings */}
            <div className="flex justify-center">
              <div className="relative w-20 h-20">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    border: '2px solid rgba(99,102,241,0.2)',
                    animation: 'ping 2s cubic-bezier(0,0,0.2,1) infinite',
                  }}
                />
                <div
                  className="absolute inset-2 rounded-full"
                  style={{
                    border: '2px solid rgba(99,102,241,0.4)',
                    animation: 'ping 2s cubic-bezier(0,0,0.2,1) infinite',
                    animationDelay: '0.5s',
                  }}
                />
                <div
                  className="absolute inset-4 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(99,102,241,0.15)', border: '2px solid var(--accent)' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/>
                  </svg>
                </div>
              </div>
            </div>
            <div>
              <p className="font-semibold text-white">
                {status === CONN_STATE.WAITING ? 'Waiting for sender…' : 'Establishing P2P connection…'}
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Setting up encrypted WebRTC channel
              </p>
            </div>
            {/* Encryption notice */}
            <div
              className="flex items-center gap-2 justify-center text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              <span>🔐 AES-256-GCM encrypted</span>
              <span>·</span>
              <span>🔒 Zero-knowledge key</span>
            </div>
          </div>
        )}

        {/* ── Transferring ── */}
        {status === CONN_STATE.TRANSFERRING && progress && (
          <div className="space-y-5 animate-fade-in">
            <div className="text-center">
              <p className="font-semibold text-white text-sm mb-1">📥 Receiving file…</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Decrypting chunks in real-time
              </p>
            </div>
            <ProgressBar progress={progress} isSender={false} />
          </div>
        )}

        {/* ── Done ── */}
        {status === CONN_STATE.DONE && fileReady && (
          <div className="space-y-5 animate-scale-in text-center">
            {/* Success icon */}
            <div className="flex justify-center">
              <div className="checkmark-circle glow-green">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
            </div>

            <div>
              <p className="font-bold text-2xl text-white">Download Complete!</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                File saved successfully to your device.
              </p>
            </div>

            {/* File info */}
            <div
              className="flex items-center gap-3 p-4 rounded-xl text-left"
              style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)' }}
            >
              <span style={{ fontSize: 28 }}>📁</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white text-sm truncate">{progress?.fileName}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {formatBytes(progress?.fileSize)}
                </p>
              </div>
            </div>

            {/* Stats */}
            {progress && (
              <TransferStats speed={progress.speed} elapsed={elapsed} totalSize={progress.fileSize} />
            )}

            {/* Hash verification */}
            <div
              className="p-4 rounded-xl text-left space-y-2"
              style={{
                background: fileReady.hashMatch ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.07)',
                border: `1px solid ${fileReady.hashMatch ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
              }}
            >
              <div className="flex items-center gap-2">
                <span>{fileReady.hashMatch ? '✅' : '❌'}</span>
                <p
                  className="font-semibold text-sm"
                  style={{ color: fileReady.hashMatch ? 'var(--success)' : 'var(--error)' }}
                >
                  SHA-256 {fileReady.hashMatch ? 'Verified — Integrity Confirmed' : 'Mismatch — File may be corrupted!'}
                </p>
              </div>
              <p className="mono text-xs break-all" style={{ color: 'var(--text-secondary)' }}>
                {fileReady.hash}
              </p>
            </div>

            {/* Re-download button */}
            <button
              className="btn-primary w-full"
              id="redownload-btn"
              onClick={() => {
                const url = URL.createObjectURL(fileReady.blob);
                const a   = document.createElement('a');
                a.href = url; a.download = progress?.fileName; a.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download Again
            </button>
          </div>
        )}

        {/* ── Disconnected ── */}
        {status === CONN_STATE.DISCONNECTED && (
          <div
            className="p-5 rounded-xl text-center space-y-3 animate-fade-in"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}
          >
            <span style={{ fontSize: 32 }}>⚠️</span>
            <p className="font-semibold" style={{ color: 'var(--error)' }}>Connection Lost</p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {error || 'The sender disconnected unexpectedly.'}
            </p>
            <button
              className="btn-secondary w-full mt-2"
              onClick={() => window.location.reload()}
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* ── Error ── */}
        {status === CONN_STATE.ERROR && error && (
          <div
            className="p-4 rounded-xl text-center space-y-3 animate-fade-in"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}
          >
            <p className="font-semibold" style={{ color: 'var(--error)' }}>❌ Error</p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error}</p>
            <button
              className="btn-secondary w-full"
              onClick={() => window.location.href = '/'}
            >
              Go Back
            </button>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <p className="mt-8 text-xs text-center animate-fade-in" style={{ color: 'var(--text-muted)' }}>
        End-to-end encrypted · File never touches our servers · WebRTC P2P
      </p>
    </div>
  );
}
