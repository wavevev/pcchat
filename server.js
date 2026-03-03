// ===== server.js =====
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const users = {}; // socket.id -> displayName

io.on("connection", (socket) => {
  socket.on("join", (rawNickname) => {
    const input = String(rawNickname || "").trim();
    if (!input) return;

    // ✅ 관리자 규칙:
    // 9996홍길동 / 9996-홍길동 / 9996:홍길동 / 9996 홍길동  => 관리자
    // 화면에는 "홍길동"만 보이게
    let isAdmin = false;
    let displayName = input;

    if (input.startsWith("9996")) {
      isAdmin = true;
      displayName = input.replace(/^9996[\s:\-]*/, "").trim();
      if (!displayName) displayName = "관리자";
    }

    socket.isAdmin = isAdmin;
    socket.nickname = displayName;
    users[socket.id] = displayName;

    // ✅ 삼각형 없이
    io.emit("system", `${displayName}님이 접속했습니다.`);
    io.emit("count", Object.keys(users).length);

    if (isAdmin) socket.emit("admin");

    // ✅ 공지: 서버에서만 1번 방송 (프론트에서 따로 찍지 않음)
    setTimeout(() => {
      io.emit("notice", "9996", "X와의 채팅을 시작합니다. 2분 동안 X에게 질문을 남겨주세요.");
    }, 400);
  });

  socket.on("chat", (msg) => {
    const text = String(msg || "").trim();
    if (!text) return;

    // ✅ 오전/오후 제거: 24시간 HH:MM
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const time = `${hh}:${mm}`;

    io.emit("chat", socket.nickname || "익명", text, time);
  });

  socket.on("disconnect", () => {
    const name = users[socket.id];
    if (name) {
      io.emit("system", `${name}님이 퇴장했습니다.`);
      delete users[socket.id];
      io.emit("count", Object.keys(users).length);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("서버 실행중");
});