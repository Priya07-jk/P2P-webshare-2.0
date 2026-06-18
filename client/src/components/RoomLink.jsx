import { useState } from 'react';

/**
 * RoomLink — displays the shareable P2P link with copy + share functionality.
 */
export default function RoomLink({ roomId, keyStr }) {
  const [copied, setCopied] = useState(false);

  const shareUrl = `${window.location.origin}/?room=${roomId}#key=${keyStr}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'P2P WebShare — File Transfer',
          text:  'Open this link to receive a file directly from my browser.',
          url:   shareUrl,
        });
      } catch { /* user cancelled */ }
    }
  };

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
          style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)' }}
        >
          🔗
        </div>
        <p className="font-semibold text-sm text-white">Share this link with the receiver</p>
      </div>

      {/* Link box */}
      <div className="link-box group" id="share-link-box">
        <svg
          className="flex-shrink-0"
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          style={{ color: 'var(--accent-light)', opacity: 0.7 }}
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        <span className="flex-1 text-xs break-all" style={{ color: 'var(--accent-light)' }}>
          {shareUrl}
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          id="copy-link-btn"
          className="btn-primary flex-1"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              Copy Link
            </>
          )}
        </button>

        {typeof navigator.share === 'function' && (
          <button
            id="share-link-btn"
            className="btn-secondary"
            onClick={handleShare}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            Share
          </button>
        )}
      </div>

      {/* Room ID badge */}
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Room ID</p>
        <div
          className="px-3 py-1.5 rounded-lg mono text-sm font-medium"
          style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--accent-light)', letterSpacing: '0.15em' }}
        >
          {roomId}
        </div>
      </div>

      {/* Security note */}
      <div
        className="flex items-start gap-3 p-3 rounded-xl text-xs"
        style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.15)' }}
      >
        <span className="text-base">🔐</span>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          The encryption key is embedded in the <span style={{ color: 'var(--accent-light)' }}>#hash</span> of this URL — 
          it's never sent to our servers. Only you and the recipient can decrypt this file.
        </p>
      </div>
    </div>
  );
}
