import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Game state storage (in-memory for this example)
  const rooms = new Map<string, any>();

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("join-room", ({ roomId, playerName, mode }) => {
      socket.join(roomId);
      
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          id: roomId,
          players: [],
          gameState: null,
          mode: mode || 'partners',
        });
      }

      const room = rooms.get(roomId);
      
      // Check if player is already in room
      const existingPlayer = room.players.find((p: any) => p.id === socket.id);
      if (!existingPlayer && room.players.length < 4) {
        const team = room.mode === 'individual' ? room.players.length : room.players.length % 2;
        room.players.push({
          id: socket.id,
          name: playerName,
          team: team,
          ready: false,
        });
      }

      io.to(roomId).emit("room-update", room);
    });

    socket.on("update-room-mode", ({ roomId, mode }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.mode = mode;
        // Update teams for all players in the room
        room.players = room.players.map((p: any, i: number) => ({
          ...p,
          team: mode === 'individual' ? i : i % 2
        }));
        io.to(roomId).emit("room-update", room);
      }
    });

    socket.on("start-game", ({ roomId, gameState }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.gameState = gameState;
        io.to(roomId).emit("game-started", gameState);
      }
    });

    socket.on("play-card", ({ roomId, playerId, cardIndex, gameState }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.gameState = gameState;
        socket.to(roomId).emit("card-played", { playerId, cardIndex, gameState });
      }
    });

    socket.on("trump-preview", ({ roomId, suit }) => {
      socket.to(roomId).emit("trump-preview", suit);
    });

    socket.on("sync-game-state", ({ roomId, gameState }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.gameState = gameState;
        socket.to(roomId).emit("game-state-synced", gameState);
      }
    });

    // WebRTC Signaling
    socket.on("offer", ({ roomId, offer, to }) => {
      socket.to(to).emit("offer", { offer, from: socket.id });
    });

    socket.on("answer", ({ roomId, answer, to }) => {
      socket.to(to).emit("answer", { answer, from: socket.id });
    });

    socket.on("ice-candidate", ({ roomId, candidate, to }) => {
      socket.to(to).emit("ice-candidate", { candidate, from: socket.id });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      for (const [roomId, room] of rooms.entries()) {
        const playerIndex = room.players.findIndex((p: any) => p.id === socket.id);
        if (playerIndex !== -1) {
          room.players.splice(playerIndex, 1);
          if (room.players.length === 0) {
            rooms.delete(roomId);
          } else {
            io.to(roomId).emit("room-update", room);
          }
        }
      }
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
