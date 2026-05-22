const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  socket.on("host:join", ({ roomId, profile }) => {
    if (!roomId) return;
    const existing = rooms.get(roomId);
    if (existing?.hostId && existing.hostId !== socket.id) {
      socket.emit("room:error", "This stream already has a host.");
      return;
    }

    socket.join(roomId);
    rooms.set(roomId, {
      hostId: socket.id,
      profile,
      viewers: new Set(existing?.viewers || [])
    });

    socket.data.role = "host";
    socket.data.roomId = roomId;
    socket.emit("host:ready", { roomId, viewers: rooms.get(roomId).viewers.size });
    socket.to(roomId).emit("stream:profile", profile);
    for (const viewerId of rooms.get(roomId).viewers) {
      socket.emit("viewer:joined", { viewerId, count: rooms.get(roomId).viewers.size });
    }
  });

  socket.on("viewer:join", ({ roomId }) => {
    if (!roomId) return;
    let room = rooms.get(roomId);
    socket.join(roomId);
    socket.data.role = "viewer";
    socket.data.roomId = roomId;

    if (!room?.hostId) {
      room = room || { hostId: null, profile: null, viewers: new Set() };
      room.viewers.add(socket.id);
      rooms.set(roomId, room);
      socket.emit("room:waiting");
      return;
    }

    room.viewers.add(socket.id);
    socket.emit("stream:profile", room.profile);
    io.to(room.hostId).emit("viewer:joined", { viewerId: socket.id, count: room.viewers.size });
  });

  socket.on("host:profile", ({ roomId, profile }) => {
    const room = rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;
    room.profile = profile;
    socket.to(roomId).emit("stream:profile", profile);
  });

  socket.on("signal:offer", ({ viewerId, description }) => {
    if (!viewerId || !description) return;
    io.to(viewerId).emit("signal:offer", { hostId: socket.id, description });
  });

  socket.on("signal:answer", ({ hostId, description }) => {
    if (!hostId || !description) return;
    io.to(hostId).emit("signal:answer", { viewerId: socket.id, description });
  });

  socket.on("signal:ice", ({ targetId, candidate }) => {
    if (!targetId || !candidate) return;
    io.to(targetId).emit("signal:ice", { fromId: socket.id, candidate });
  });

  socket.on("disconnect", () => {
    const { role, roomId } = socket.data;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    if (role === "host" && room.hostId === socket.id) {
      socket.to(roomId).emit("host:left");
      rooms.delete(roomId);
      return;
    }

    if (role === "viewer") {
      room.viewers.delete(socket.id);
      if (room.hostId) {
        io.to(room.hostId).emit("viewer:left", { viewerId: socket.id, count: room.viewers.size });
      }
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Screen Stream Share running at http://localhost:${port}`);
});
