const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

let users = {};
let chatLogs = [];

io.on("connection", (socket) => {

  socket.on("join", ({ nickname, isAdmin }) => {
    users[socket.id] = { nickname, isAdmin };

    socket.broadcast.emit("system", `▶ ${nickname}님이 접속했습니다.`);
    io.emit("count", Object.keys(users).length);

    // 기존 채팅 로그 전송
    socket.emit("init logs", chatLogs);
  });

  socket.on("chat", (msg) => {
    const user = users[socket.id];
    if (!user) return;

    // 관리자 명령어
    if (user.isAdmin && msg.startsWith("/notice ")) {
      const text = msg.replace("/notice ", "");
      io.emit("system", `📢 공지: ${text}`);
      return;
    }

    if (user.isAdmin && msg === "/admins") {
      const adminList = Object.values(users)
        .filter(u => u.isAdmin)
        .map(u => u.nickname)
        .join(", ");
      socket.emit("system", `👑 관리자 목록: ${adminList}`);
      return;
    }

    if (user.isAdmin && msg.startsWith("/kick ")) {
      const target = msg.replace("/kick ", "");
      for (let id in users) {
        if (users[id].nickname === target) {
          io.to(id).emit("system", "🚫 관리자에 의해 퇴장되었습니다.");
          io.sockets.sockets.get(id)?.disconnect();
        }
      }
      return;
    }

    const formatted = `${user.nickname} > ${msg}`;
    chatLogs.push(formatted);
    if (chatLogs.length > 100) chatLogs.shift();

    socket.broadcast.emit("chat", formatted);
  });

  socket.on("disconnect", () => {
    if (users[socket.id]) {
      socket.broadcast.emit("system", `◀ ${users[socket.id].nickname}님이 퇴장했습니다.`);
      delete users[socket.id];
      io.emit("count", Object.keys(users).length);
    }
  });
});

server.listen(process.env.PORT || 3000);
