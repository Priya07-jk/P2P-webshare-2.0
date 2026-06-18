import { useRef, useCallback, useState, useMemo } from 'react';
import {
  generateKey, exportKey, importKey,
  encryptChunk, decryptChunk, hashBuffer, hashFile,
} from '../utils/crypto.js';
import {
  readChunk, getTotalChunks, createChunkStore, CHUNK_SIZE, OPFS_THRESHOLD,
} from '../utils/chunker.js';

// ─── ICE Configuration (STUN servers) ─────────────────────────────────────────
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

// ─── Transfer State ────────────────────────────────────────────────────────────
export const CONN_STATE = {
  IDLE:          'idle',
  WAITING:       'waiting',
  CONNECTING:    'connecting',
  CONNECTED:     'connected',
  TRANSFERRING:  'transferring',
  DONE:          'done',
  ERROR:         'error',
  DISCONNECTED:  'disconnected',
};

/**
 * useWebRTC — core P2P file transfer hook.
 */
export function useWebRTC({ onProgress, onStatus, onFileReady, onError, onPeerDisconnected }) {
  const pcRef      = useRef(null);    // RTCPeerConnection
  const ctrlRef    = useRef(null);    // control RTCDataChannel
  const fileRef    = useRef(null);    // file RTCDataChannel
  const keyRef     = useRef(null);    // CryptoKey
  const storeRef   = useRef(null);    // RamChunkStore | OpfsChunkStore
  const metaRef    = useRef(null);    // received file metadata

  // ─── Store Callbacks in Ref to prevent re-renders ──────────────────────────
  const cbRef = useRef({ onProgress, onStatus, onFileReady, onError, onPeerDisconnected });
  cbRef.current = { onProgress, onStatus, onFileReady, onError, onPeerDisconnected };

  const iceQueueRef = useRef([]);
  const statsRef   = useRef({ startTime: 0, lastTime: 0, lastBytes: 0 });

  // ─── Create RTCPeerConnection ─────────────────────────────────────────────
  const createPC = useCallback((sendSignal, roomId) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) sendSignal(roomId, { type: 'ice-candidate', candidate });
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      // Do not set CONNECTED here, wait for DataChannel onopen.
      if (s === 'disconnected' || s === 'failed' || s === 'closed') {
        cbRef.current.onStatus(CONN_STATE.DISCONNECTED);
        cbRef.current.onPeerDisconnected?.();
      }
    };

    pcRef.current = pc;
    iceQueueRef.current = [];
    return pc;
  }, []);

  // ─── Process ICE Queue ────────────────────────────────────────────────────
  const processIceQueue = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;
    const queue = iceQueueRef.current;
    iceQueueRef.current = []; // clear it immediately
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (e) {
        console.warn('Failed to add queued ICE candidate', e);
      }
    }
  }, []);

  // ─── SENDER: Initialize ───────────────────────────────────────────────────
  const initSender = useCallback(async (file) => {
    cbRef.current.onStatus(CONN_STATE.WAITING);
    // Generate AES-GCM key
    const key = await generateKey();
    keyRef.current = key;
    const keyStr = await exportKey(key);
    // Pre-compute SHA-256 hash of original file
    const hash = await hashFile(file);
    return { keyStr, hash };
  }, []);

  // ─── SENDER: Create Offer ─────────────────────────────────────────────────
  const createOffer = useCallback(async (file, roomId, sendSignal) => {
    const pc = createPC(sendSignal, roomId);

    // Control channel — metadata, control signals
    const ctrl = pc.createDataChannel('control', { ordered: true });
    ctrlRef.current = ctrl;

    // File channel — raw encrypted chunks (binary)
    const fileCh = pc.createDataChannel('file', {
      ordered: true,
      // Use reliable, ordered delivery for file integrity
    });
    fileRef.current = fileCh;
    fileCh.bufferedAmountLowThreshold = 256 * 1024; // 256 KB

    // Wait for the file channel to be ready before declaring connection success
    fileCh.onopen = () => {
      cbRef.current.onStatus(CONN_STATE.CONNECTED);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(roomId, { type: 'offer', sdp: offer });
    cbRef.current.onStatus(CONN_STATE.CONNECTING);
  }, [createPC]);

  // ─── SENDER: Handle Answer ────────────────────────────────────────────────
  const handleAnswer = useCallback(async ({ sdp }) => {
    await pcRef.current?.setRemoteDescription(new RTCSessionDescription(sdp));
    await processIceQueue();
  }, [processIceQueue]);

  // ─── SENDER: Start Transfer ───────────────────────────────────────────────
  const startTransfer = useCallback(async (file, hash) => {
    const ctrl   = ctrlRef.current;
    const fileCh = fileRef.current;
    if (!ctrl || !fileCh) return;

    const totalChunks = getTotalChunks(file.size);
    const useOpfs = file.size > OPFS_THRESHOLD;

    // Send metadata over control channel
    ctrl.send(JSON.stringify({
      type: 'file-meta',
      name:        file.name,
      size:        file.size,
      fileType:    file.type,
      totalChunks,
      hash,
      chunkSize:   CHUNK_SIZE,
      useOpfs,
    }));

    cbRef.current.onStatus(CONN_STATE.TRANSFERRING);
    statsRef.current = { startTime: Date.now(), lastTime: Date.now(), lastBytes: 0 };

    let chunkIndex = 0;

    const sendNext = async () => {
      while (chunkIndex < totalChunks) {
        // Back-pressure: wait if buffer is too full
        if (fileCh.bufferedAmount > 4 * 1024 * 1024) {
          await new Promise((res) => {
            fileCh.onbufferedamountlow = () => { fileCh.onbufferedamountlow = null; res(); };
          });
        }

        const chunk    = await readChunk(file, chunkIndex);
        const encrypted = await encryptChunk(keyRef.current, chunk);

        // Packet format: [4 bytes: chunkIndex (Uint32BE)][encrypted data]
        const packet = new ArrayBuffer(4 + encrypted.byteLength);
        const view   = new DataView(packet);
        view.setUint32(0, chunkIndex, false); // big-endian
        new Uint8Array(packet, 4).set(new Uint8Array(encrypted));
        fileCh.send(packet);

        chunkIndex++;

        // Update progress
        const now       = Date.now();
        const elapsed   = (now - statsRef.current.startTime) / 1000;
        const bytesSent = chunkIndex * CHUNK_SIZE;
        const speed     = bytesSent / elapsed;
        const remaining = (file.size - bytesSent) / speed;

        cbRef.current.onProgress({
          percent: chunkIndex / totalChunks,
          speed,
          eta: remaining,
          chunkIndex,
          totalChunks,
        });
      }

      // Signal completion
      ctrl.send(JSON.stringify({ type: 'done', hash }));
    };

    await sendNext();
  }, []);

  // ─── RECEIVER: Initialize ─────────────────────────────────────────────────
  const initReceiver = useCallback(async (keyStr) => {
    if (!keyStr) throw new Error('No encryption key in URL. Link may be corrupted.');
    const key = await importKey(keyStr);
    keyRef.current = key;
  }, []);

  // ─── RECEIVER: Handle Offer ───────────────────────────────────────────────
  const handleOffer = useCallback(async ({ sdp }, roomId, sendSignal) => {
    const pc = createPC(sendSignal, roomId);
    cbRef.current.onStatus(CONN_STATE.CONNECTING);

    // Listen for data channels from sender
    pc.ondatachannel = ({ channel }) => {
      if (channel.label === 'control') {
        ctrlRef.current = channel;
        channel.onmessage = handleControlMessage;
      }
      if (channel.label === 'file') {
        fileRef.current  = channel;
        channel.binaryType = 'arraybuffer';
        channel.onmessage  = handleFileMessage;
        
        if (channel.readyState === 'open') {
          cbRef.current.onStatus(CONN_STATE.CONNECTED);
        } else {
          channel.onopen = () => cbRef.current.onStatus(CONN_STATE.CONNECTED);
        }
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await processIceQueue();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal(roomId, { type: 'answer', sdp: answer });
  }, [createPC, processIceQueue]);

  // ─── RECEIVER: Finalize Transfer ──────────────────────────────────────────
  const finalizeTransfer = useCallback(async () => {
    const store = storeRef.current;
    const meta  = metaRef.current;
    if (!store || !meta || !meta.expectedHash) return;

    let buffer;
    let blob;

    try {
      if (store.init) {
        // OPFS path: finalize file
        const file = await store.finalize(meta.fileType);
        blob = file;
        buffer = await file.arrayBuffer();
      } else {
        buffer = store.assemble();
        blob   = new Blob([buffer], { type: meta.fileType });
      }

      // Verify SHA-256 hash
      const receivedHash = await hashBuffer(buffer);
      const hashMatch    = receivedHash === meta.expectedHash;

      cbRef.current.onStatus(CONN_STATE.DONE);
      cbRef.current.onFileReady({ blob, fileName: meta.name, hashMatch, hash: meta.expectedHash, receivedHash });

      // Auto-download
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = meta.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      // Cleanup OPFS temp file
      if (store.cleanup) await store.cleanup();
    } catch (e) {
      console.error('Finalize transfer failed:', e);
      cbRef.current.onError(e);
      cbRef.current.onStatus(CONN_STATE.ERROR);
    }
  }, []);

  // ─── RECEIVER: Handle Control Messages ────────────────────────────────────
  const handleControlMessage = useCallback(async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'file-meta') {
      metaRef.current = msg;
      const store = createChunkStore(msg.size, msg.totalChunks, msg.name);
      if (store.init) await store.init(); // OPFS init
      storeRef.current = store;
      statsRef.current = { startTime: Date.now(), lastTime: Date.now(), lastBytes: 0 };
      cbRef.current.onStatus(CONN_STATE.TRANSFERRING);

      // Notify UI of incoming file
      cbRef.current.onProgress({
        percent: 0, speed: 0, eta: Infinity,
        chunkIndex: 0, totalChunks: msg.totalChunks,
        fileName: msg.name, fileSize: msg.size, fileType: msg.fileType,
      });
    }

    if (msg.type === 'done') {
      if (metaRef.current) {
        metaRef.current.expectedHash = msg.hash;
        if (storeRef.current?.isComplete) {
          finalizeTransfer();
        }
      }
    }
  }, [finalizeTransfer]);

  // ─── RECEIVER: Handle File Chunk Messages ─────────────────────────────────
  const handleFileMessage = useCallback(async (event) => {
    const store = storeRef.current;
    const meta  = metaRef.current;
    if (!store || !meta) return;

    const packet     = event.data; // ArrayBuffer
    const view       = new DataView(packet);
    const chunkIndex = view.getUint32(0, false);
    const encrypted  = packet.slice(4);

    // Decrypt chunk
    const decrypted = await decryptChunk(keyRef.current, encrypted);

    // Store (RAM or OPFS)
    if (store.init) {
      await store.addChunk(chunkIndex, decrypted);
    } else {
      store.addChunk(chunkIndex, decrypted);
    }

    // Update progress
    const now     = Date.now();
    const elapsed = (now - statsRef.current.startTime) / 1000 || 0.001;
    const bytesReceived = store.receivedCount * CHUNK_SIZE;
    const speed   = bytesReceived / elapsed;
    const remaining = (meta.size - bytesReceived) / speed;

    cbRef.current.onProgress({
      percent:     store.progress,
      speed,
      eta:         remaining,
      chunkIndex,
      totalChunks: meta.totalChunks,
      fileName:    meta.name,
      fileSize:    meta.size,
      fileType:    meta.fileType,
    });

    if (store.isComplete && meta.expectedHash) {
      finalizeTransfer();
    }
  }, [finalizeTransfer]);

  // ─── Add ICE Candidate ─────────────────────────────────────────────────────
  const addIceCandidate = useCallback(async (candidate) => {
    const pc = pcRef.current;
    if (!pc) return;
    
    const iceCandidate = new RTCIceCandidate(candidate);
    
    if (pc.remoteDescription) {
      try {
        await pc.addIceCandidate(iceCandidate);
      } catch (e) {
        console.warn('Failed to add ICE candidate', e);
      }
    } else {
      // Queue it up if remote description is not ready yet
      iceQueueRef.current.push(iceCandidate);
    }
  }, []);

  // ─── Cleanup ───────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    ctrlRef.current?.close();
    fileRef.current?.close();
    pcRef.current?.close();
    ctrlRef.current = null;
    fileRef.current = null;
    pcRef.current   = null;
    iceQueueRef.current = [];
  }, []);

  return useMemo(() => ({
    initSender,
    createOffer,
    handleAnswer,
    startTransfer,
    initReceiver,
    handleOffer,
    addIceCandidate,
    cleanup,
  }), [initSender, createOffer, handleAnswer, startTransfer, initReceiver, handleOffer, addIceCandidate, cleanup]);
}
