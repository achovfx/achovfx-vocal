const { createServer } = require('http');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
const PORT = process.env.PORT || 3000;

const rooms = new Map();

function cleanupSocket(io, socket) {
  const roomId = socket.data.roomId;
  if (roomId && rooms.has(roomId)) {
    rooms.get(roomId).delete(socket.id);
    if (rooms.get(roomId).size === 0) rooms.delete(roomId);
    socket.to(roomId).emit('user-left', { id: socket.id });
  }
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    socket.on('join-room', ({ roomId, name }) => {
      if (!roomId || !name) return;
      roomId = String(roomId).trim().slice(0, 64);
      name = String(name).trim().slice(0, 40);
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.name = name;
      if (!rooms.has(roomId)) rooms.set(roomId, new Map());
      const room = rooms.get(roomId);
      const existingUsers = Array.from(room.entries()).map(([id, n]) => ({ id, name: n }));
      room.set(socket.id, name);
      socket.emit('existing-users', existingUsers);
      socket.to(roomId).emit('user-joined', { id: socket.id, name });
    });

    socket.on('signal', ({ to, data }) => {
      if (!to || !data) return;
      io.to(to).emit('signal', { from: socket.id, data });
    });

    socket.on('chat-message', ({ message }) => {
      const roomId = socket.data.roomId;
      if (!roomId || !message) return;
      io.to(roomId).emit('chat-message', {
        id: socket.id,
        name: socket.data.name || 'کاربر',
        message: String(message).slice(0, 1000),
        time: Date.now(),
      });
    });

    socket.on('leave-room', () => cleanupSocket(io, socket));
    socket.on('disconnect', () => cleanupSocket(io, socket));
  });

  httpServer.listen(PORT, () => console.log(`> Voice Lounge ready on http://localhost:${PORT}`));
});
