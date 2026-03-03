/* =============================
   PC통신 레트로 채팅 - 확장 버전
   (효과음 선택 + ASCII 테두리 강화)
   ============================= */

// ===== server.js =====

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const path = require("path");

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.send("서버는 정상 작동 중입니다.");
});

let users = {};
let admins = new Set(["9996"]);

io.on("connection", (socket) => {

  socket.on("join", (nickname) => {
    socket.nickname = nickname;
    users[socket.id] = nickname;

    io.emit("system", `▶ ${nickname}님이 접속했습니다.`);
    io.emit("count", Object.keys(users).length);

    if (admins.has(nickname)) {
      socket.emit("admin");
    }

    setTimeout(() => {
      socket.emit("notice", "9996", "X와의 채팅을 시작합니다. 2분 동안 질문을 남겨주세요.");
    }, 500);
  });

  socket.on("chat", (msg) => {
    const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    io.emit("chat", socket.nickname, msg, time);
  });

  socket.on("disconnect", () => {
    if (users[socket.id]) {
      io.emit("system", `◀ ${users[socket.id]}님이 퇴장했습니다.`);
      delete users[socket.id];
      io.emit("count", Object.keys(users).length);
    }
  });
});

const PORT = process.env.PORT;

server.listen(PORT, () => {
  console.log("서버 실행중 on port " + PORT);
});