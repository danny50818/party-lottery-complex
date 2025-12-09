// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 提供靜態檔案（index.html）
app.use(express.static(__dirname));

/**
 * players: Map<socketId, { no: string, name: string }>
 * winners: Set<playerNo>
 */
const players = new Map();
const winners = new Set();
let nextPlayerNumber = 1;

function formatNo(n) {
  return "No. " + String(n).padStart(3, "0");
}

function broadcastPlayers() {
  const list = Array.from(players.values()).map((p) => ({
    no: p.no,
    name: p.name,
  }));
  io.emit("players-updated", { players: list, winners: Array.from(winners) });
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // 玩家加入
  socket.on("join", (data, callback) => {
    const name = (data && data.name ? String(data.name) : "").trim();
    if (!name) {
      callback && callback({ success: false, message: "名稱不可空白" });
      return;
    }

    // 已存在的話先移除舊紀錄（避免重複）
    if (players.has(socket.id)) {
      players.delete(socket.id);
    }

    const no = formatNo(nextPlayerNumber++);
    players.set(socket.id, { no, name });

    callback && callback({ success: true, no, name });
    broadcastPlayers();
  });

  // 主持人請求抽出一位中獎者
  socket.on("request-winner", (data, callback) => {
    const available = Array.from(players.values()).filter(
      (p) => !winners.has(p.no)
    );

    if (available.length === 0) {
      callback &&
        callback({ success: false, message: "可供抽獎的玩家已用完" });
      return;
    }

    const winner =
      available[Math.floor(Math.random() * available.length)];

    winners.add(winner.no);

    // 找到該玩家的 socket id
    let winnerSocketId = null;
    for (const [sid, player] of players.entries()) {
      if (player.no === winner.no) {
        winnerSocketId = sid;
        break;
      }
    }

    // 通知該玩家中獎
    if (winnerSocketId) {
      io.to(winnerSocketId).emit("you-win", {
        no: winner.no,
        name: winner.name,
      });
    }

    // 廣播目前玩家與得獎狀態
    broadcastPlayers();

    callback &&
      callback({
        success: true,
        winner: {
          no: winner.no,
          name: winner.name,
        },
      });
  });

  // 重置活動：清空所有資料並強制登出
  socket.on("reset-activity", () => {
    players.clear();
    winners.clear();
    nextPlayerNumber = 1;
    io.emit("force-logout");
    broadcastPlayers();
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    broadcastPlayers();
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
