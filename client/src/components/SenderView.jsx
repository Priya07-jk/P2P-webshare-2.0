import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../hooks/useSocket.js';
import { useWebRTC, CONN_STATE } from '../hooks/useWebRTC.js';
import { ConnectionStatus, ProgressBar, TransferStats } from './ProgressBar.jsx';
import { formatBytes } from '../utils/chunker.js';

export default function SenderView() {
  const [file,      setFile]      = useState(null);
  const [roomId,    setRoomId]    = useState('');
  const [keyStr,    setKeyStr]    = useState('');
  const [fileHash,  setFileHash]  = useState('');
  const [status,    setStatus]    = useState(CONN_STATE.IDLE);
  const [progress,  setProgress]  = useState(null);
  const [error,     setError]     = useState('');
  const [startTime, setStartTime] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const socket = useSocket();
  const webrtc = useWebRTC({
    onProgress: (p) => setProgress(p),
    onStatus:   setStatus,
    onFileReady: () => {}, // Sender doesn't receive files
    onError:    (e) => setError(e.message),
    onPeerDisconnected: () => {
      if (status !== CONN_STATE.DONE) {
        setStatus(CONN_STATE.DISCONNECTED);
        setError('Receiver disconnected.');
      }
    },
  });

  // ── Step 1: File selected → init + create room ─────────────────────────────
  const handleFile = useCallback(async (selectedFile) => {
    setFile(selectedFile);
    setError('');
    try {
      // Generate encryption key and compute file hash
      const { keyStr: k, hash } = await webrtc.initSender(selectedFile);
      setKeyStr(k);
      setFileHash(hash);

      // Create signaling room (wait for receiver before creating offer)
      const id = await socket.createRoom();
      setRoomId(id);
    } catch (err) {
      setError(err.message);
      setStatus(CONN_STATE.ERROR);
    }
  }, [socket, webrtc]);

  // ── Step 2: Receiver joined (Socket) → create offer ────────────────────────
  useEffect(() => {
    const off = socket.onPeerJoined(() => {
      setStatus(CONN_STATE.CONNECTING);
      if (file && roomId) {
        webrtc.createOffer(file, roomId, socket.sendSignal).catch(err => {
          setError(err.message);
          setStatus(CONN_STATE.ERROR);
        });
      }
    });
    return off;
  }, [socket, file, roomId, webrtc]);

  // ── Handle signals from receiver ───────────────────────────────────────────
  useEffect(() => {
    const off = socket.onSignal(async ({ signal }) => {
      if (signal.type === 'answer') {
        await webrtc.handleAnswer(signal);
      } else if (signal.type === 'ice-candidate') {
        await webrtc.addIceCandidate(signal.candidate);
      }
    });
    return off;
  }, [socket, webrtc]);

  // ── Peer disconnected ──────────────────────────────────────────────────────
  useEffect(() => {
    const off = socket.onPeerDisconnected(() => {
      if (status !== CONN_STATE.DONE) {
        setStatus(CONN_STATE.DISCONNECTED);
        setError('The receiver closed the connection.');
      }
    });
    return off;
  }, [socket, status]);

  // ── Step 3: WebRTC Connected → start actual transfer ───────────────────────
  useEffect(() => {
    if (status === CONN_STATE.CONNECTED && file && fileHash && !startTime) {
      setStartTime(Date.now());
      webrtc.startTransfer(file, fileHash).then(() => {
        setStatus(CONN_STATE.DONE);
      }).catch(err => {
        setError(err.message);
        setStatus(CONN_STATE.ERROR);
      });
    }
  }, [status, file, fileHash, startTime, webrtc]);

  // ── File Drag & Drop Handlers ──────────────────────────────────────────────
  const onDragOver = (e) => { e.preventDefault(); setIsDragOver(true); };
  const onDragLeave = (e) => { e.preventDefault(); setIsDragOver(false); };
  const onDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.length) handleFile(e.dataTransfer.files[0]);
  };
  const onFileInput = (e) => {
    if (e.target.files?.length) handleFile(e.target.files[0]);
  };

  const elapsed = startTime ? (Date.now() - startTime) / 1000 : 0;

  // ── Room Link Component ──
  const RoomLink = ({ roomId, keyStr }) => {
    const [copied, setCopied] = useState(false);
    const link = `${window.location.origin}/?room=${roomId}#key=${keyStr}`;

    const handleCopy = () => {
      navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <div className="space-y-4 animate-scale-in">
        <div className="flex items-center gap-2 mb-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--success)' }}>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          <span className="font-semibold text-white">Share this link with the receiver</span>
        </div>
        
        <div 
          className="p-4 rounded-xl break-all mono text-sm flex items-center gap-3"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>🔗</span>
          <span className="flex-1" style={{ color: 'var(--accent-light)' }}>{link}</span>
        </div>

        <button className="btn-primary w-full shadow-lg" onClick={handleCopy}>
          {copied ? 'Copied to clipboard! ✓' : 'Copy Link'}
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-12">
      
      {/* ── Header ── */}
      <div className="text-center mb-10 animate-slide-up">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div 
            style={{ 
              width: 48, height: 48, borderRadius: 14, 
              background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 30px rgba(99,102,241,0.4)',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </div>
          <h1 className="text-3xl font-black gradient-text tracking-tight">P2P WebShare</h1>
        </div>
        <p className="text-base max-w-sm" style={{ color: 'var(--text-secondary)' }}>
          Send files securely directly from your browser to anyone.
        </p>
      </div>

      {/* ── Main Card ── */}
      <div className="glass-card w-full max-w-lg p-8 space-y-6 animate-scale-in">
        
        {/* Status Bar */}
        <div className="flex items-center justify-between">
          <ConnectionStatus status={status} />
          {roomId && (
            <div 
              className="px-3 py-1.5 rounded-lg mono text-xs font-medium"
              style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--accent-light)', letterSpacing: '0.1em' }}
            >
              {roomId}
            </div>
          )}
        </div>

        <div className="divider" />

        {/* ── Initial State: Upload Box ── */}
        {status === CONN_STATE.IDLE && !file && (
          <label
            className={`upload-zone flex flex-col items-center justify-center cursor-pointer ${isDragOver ? 'border-indigo-400 bg-indigo-500/10' : ''}`}
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'rgba(99,102,241,0.15)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <p className="font-semibold text-lg text-white mb-2">Click or drag file here</p>
            <p className="text-sm text-center px-4" style={{ color: 'var(--text-muted)' }}>
              Any file type. Limitless size. <br/> Highly secure P2P encryption.
            </p>
            <input type="file" className="hidden" onChange={onFileInput} />
          </label>
        )}

        {/* ── Selected File Info ── */}
        {file && (
          <div className="flex items-center gap-4 p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.2)' }}>
              <span style={{ fontSize: 24 }}>📄</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm truncate">{file.name}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{formatBytes(file.size)}</p>
            </div>
            <div className="text-xs font-bold px-2 py-1 rounded" style={{ background: 'var(--success)', color: '#000' }}>
              PLAIN
            </div>
          </div>
        )}

        {/* ── Waiting for Receiver ── */}
        {status === CONN_STATE.WAITING && roomId && keyStr && (
          <RoomLink roomId={roomId} keyStr={keyStr} />
        )}

        {/* ── Transferring ── */}
        {status === CONN_STATE.TRANSFERRING && progress && (
          <div className="space-y-4 animate-fade-in">
             <div className="text-center">
              <p className="font-semibold text-white text-sm mb-1">📤 Sending file securely…</p>
            </div>
            <ProgressBar progress={progress} isSender={true} />
          </div>
        )}

        {/* ── Done ── */}
        {status === CONN_STATE.DONE && (
          <div className="space-y-5 animate-scale-in text-center">
            <div className="flex justify-center">
              <div className="checkmark-circle glow-green">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
            </div>
            <div>
              <p className="font-bold text-2xl text-white">Transfer Complete!</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                The file was successfully sent to the receiver.
              </p>
            </div>
            {progress && (
              <TransferStats speed={progress.speed} elapsed={elapsed} totalSize={file?.size} />
            )}
            <button className="btn-secondary w-full" onClick={() => window.location.reload()}>
              Send Another File
            </button>
          </div>
        )}

        {/* ── Disconnected ── */}
        {status === CONN_STATE.DISCONNECTED && (
          <div className="p-4 rounded-xl text-center space-y-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span style={{ fontSize: 24 }}>⚠️</span>
            <p className="font-semibold text-sm" style={{ color: 'var(--error)' }}>Connection Lost</p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{error || 'The receiver disconnected.'}</p>
            <button className="btn-secondary w-full py-2 text-xs" onClick={() => window.location.reload()}>Reset & Try Again</button>
          </div>
        )}

        {/* ── Error ── */}
        {status === CONN_STATE.ERROR && error && (
          <div className="p-4 rounded-xl text-center space-y-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <p className="font-semibold text-sm" style={{ color: 'var(--error)' }}>❌ Error occurred</p>
            <p className="text-xs break-all" style={{ color: 'var(--text-secondary)' }}>{error}</p>
            <button className="btn-secondary w-full py-2 text-xs" onClick={() => window.location.reload()}>Reload App</button>
          </div>
        )}
      </div>

      <p className="mt-8 text-xs text-center animate-fade-in" style={{ color: 'var(--text-muted)' }}>
        End-to-end encrypted · File never touches our servers · WebRTC P2P
      </p>
    </div>
  );
}
