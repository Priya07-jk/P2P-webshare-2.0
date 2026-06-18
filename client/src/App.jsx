import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from './hooks/useSocket.js';
import { useWebRTC, CONN_STATE } from './hooks/useWebRTC.js';
import SenderView from './components/SenderView.jsx';
import ReceiverView from './components/ReceiverView.jsx';

/**
 * App — main router.
 * - If URL has ?room=... → Receiver view
 * - Otherwise → Sender view
 * - URL hash #key=... carries the AES-GCM decryption key (never sent to server)
 */
export default function App() {
  const params  = new URLSearchParams(window.location.search);
  const roomId  = params.get('room');
  const keyStr  = window.location.hash.replace('#key=', '');
  const isReceiver = Boolean(roomId && keyStr);

  return (
    <>
      {/* Animated aurora background */}
      <div className="aurora-bg">
        <div className="aurora-orb aurora-orb-1" />
        <div className="aurora-orb aurora-orb-2" />
        <div className="aurora-orb aurora-orb-3" />
      </div>

      {/* Grid overlay for depth */}
      <div
        className="fixed inset-0 z-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(99,102,241,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,102,241,0.5) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Main content */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {isReceiver
          ? <ReceiverView roomId={roomId} keyStr={keyStr} />
          : <SenderView />
        }
      </div>
    </>
  );
}
