/**
 * P2P WebShare — Signaling Server
 *
 * This server ONLY coordinates the initial WebRTC handshake (SDP offers/answers
 * and ICE candidates). It never reads, stores, or processes any file data.
 *
 * Architecture:
 *   Sender ──── signal ──── Server ──── signal ──── Receiver
 *                              ↑
 *                        (relay only)
 */

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();

// ─── CORS Configuration ───────────────────────────────────────────────────────
const CLIENT_URL = process.env.CLIENT_URL || '*';
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

// ─── HTTP Server + Socket.io ───────────────────────────────────────────────────
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
  },
  // Increase max buffer size for ICE candidates (still no file data)
  maxHttpBufferSize: 1e6,
});

// ─── Room Store ────────────────────────────────────────────────────────────────
// roomId → { senderId, receiverId, createdAt }
const rooms = new Map();

// ─── Cleanup: remove rooms older than 1 hour ──────────────────────────────────
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [roomId, room] of rooms.entries()) {
    if (room.createdAt < oneHourAgo) {
      rooms.delete(roomId);
      console.log(`[Cleanup] Removed expired room: ${roomId}`);
    }
  }
}, 10 * 60 * 1000); // Run every 10 minutes

// ─── Socket.io Events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Connect] Socket: ${socket.id}`);

  // ── Create Room (Sender) ──────────────────────────────────────────────────
  socket.on('create-room', (callback) => {
    try {
      // Generate a short, readable room ID (e.g. "A3F7-B2K1")
      const roomId = uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase();
      const roomData = {
        senderId: socket.id,
        receiverId: null,
        createdAt: Date.now(),
      };
      rooms.set(roomId, roomData);
      socket.join(roomId);
      socket.roomId = roomId;
      socket.role = 'sender';

      console.log(`[Room Created] ${roomId} by ${socket.id}`);
      callback({ success: true, roomId });
    } catch (err) {
      console.error('[create-room error]', err);
      callback({ success: false, error: 'Failed to create room' });
    }
  });

  // ── Join Room (Receiver) ──────────────────────────────────────────────────
  socket.on('join-room', ({ roomId }, callback) => {
    try {
      const room = rooms.get(roomId);

      if (!room) {
        return callback({ success: false, error: 'Room not found. The link may have expired.' });
      }
      if (room.receiverId && room.receiverId !== socket.id) {
        const activeSocket = io.sockets.sockets.get(room.receiverId);
        if (activeSocket) {
          return callback({ success: false, error: 'Room is full. Only one receiver allowed.' });
        }
      }

      room.receiverId = socket.id;
      socket.join(roomId);
      socket.roomId = roomId;
      socket.role = 'receiver';

      console.log(`[Room Joined] ${roomId} by receiver ${socket.id}`);
      callback({ success: true });

      // Notify sender that a peer has joined — trigger offer creation
      socket.to(roomId).emit('peer-joined', { receiverId: socket.id });
    } catch (err) {
      console.error('[join-room error]', err);
      callback({ success: false, error: 'Failed to join room' });
    }
  });

  // ── Relay WebRTC Signals (offer / answer / ice-candidate) ─────────────────
  // This is the ONLY data the server ever relays — no file bytes, ever.
  socket.on('signal', ({ roomId, signal }) => {
    if (!roomId || !signal) return;
    // Relay to everyone in the room except the sender
    socket.to(roomId).emit('signal', {
      signal,
      from: socket.id,
    });
  });

  // ── Handle Reconnection Attempt ───────────────────────────────────────────
  socket.on('reconnect-room', ({ roomId, role }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) return callback({ success: false, error: 'Room expired' });

      socket.join(roomId);
      socket.roomId = roomId;
      socket.role = role;

      if (role === 'sender') room.senderId = socket.id;
      else room.receiverId = socket.id;

      callback({ success: true });
      socket.to(roomId).emit('peer-reconnected', { role });
    } catch (err) {
      callback({ success: false, error: 'Reconnect failed' });
    }
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    console.log(`[Disconnect] ${socket.role} left room ${roomId}. Reason: ${reason}`);

    // Notify the other peer about the disconnection
    socket.to(roomId).emit('peer-disconnected', {
      role: socket.role,
      reason,
    });

    if (room) {
      if (socket.role === 'sender') {
        // Sender left — delete the room entirely
        rooms.delete(roomId);
        console.log(`[Room Deleted] ${roomId} (sender left)`);
      } else {
        // Receiver left — keep room open for potential reconnect
        room.receiverId = null;
      }
    }
  });
});

// ─── Health Check Endpoint ─────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeRooms: rooms.size,
    timestamp: new Date().toISOString(),
  });
});

app.get('/room/:roomId/status', (req, res) => {
  const room = rooms.get(req.params.roomId.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    exists: true,
    hasSender: !!room.senderId,
    hasReceiver: !!room.receiverId,
  });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 P2P WebShare Signaling Server`);
  console.log(`   Port    : ${PORT}`);
  console.log(`   CORS    : ${CLIENT_URL}`);
  console.log(`   Note    : No file data ever passes through this server.\n`);
});
