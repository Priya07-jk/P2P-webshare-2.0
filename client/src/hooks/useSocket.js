import { useEffect, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

/**
 * useSocket — manages Socket.io connection to the signaling server.
 * Returns stable socket ref + helper methods.
 */
export function useSocket() {
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  const createRoom = useCallback(() =>
    new Promise((resolve, reject) => {
      if (!socketRef.current) return reject(new Error('Socket not ready'));
      socketRef.current.emit('create-room', (res) => {
        if (res.success) resolve(res.roomId);
        else reject(new Error(res.error));
      });
    }), []);

  const joinRoom = useCallback((roomId) =>
    new Promise((resolve, reject) => {
      if (!socketRef.current) return reject(new Error('Socket not ready'));
      socketRef.current.emit('join-room', { roomId }, (res) => {
        if (res.success) resolve();
        else reject(new Error(res.error));
      });
    }), []);

  const sendSignal = useCallback((roomId, signal) => {
    socketRef.current?.emit('signal', { roomId, signal });
  }, []);

  const onSignal = useCallback((handler) => {
    socketRef.current?.on('signal', handler);
    return () => socketRef.current?.off('signal', handler);
  }, []);

  const onPeerJoined = useCallback((handler) => {
    socketRef.current?.on('peer-joined', handler);
    return () => socketRef.current?.off('peer-joined', handler);
  }, []);

  const onPeerDisconnected = useCallback((handler) => {
    socketRef.current?.on('peer-disconnected', handler);
    return () => socketRef.current?.off('peer-disconnected', handler);
  }, []);

  const onPeerReconnected = useCallback((handler) => {
    socketRef.current?.on('peer-reconnected', handler);
    return () => socketRef.current?.off('peer-reconnected', handler);
  }, []);

  return useMemo(() => ({
    socket: socketRef,
    createRoom,
    joinRoom,
    sendSignal,
    onSignal,
    onPeerJoined,
    onPeerDisconnected,
    onPeerReconnected,
  }), [createRoom, joinRoom, sendSignal, onSignal, onPeerJoined, onPeerDisconnected, onPeerReconnected]);
}
