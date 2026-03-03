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

// ✅ 세션(2분) + 잠금 상태를 서버가 관리 (권장)
let sessionStarted = false;
let locked = false;
let remaining = 120;
let tickTimer = null;
let noticeSent = false;

function startSessionIfNeeded() {
  if (sessionStarted) return;
  sessionStarted = true;
  locked = false;
  remaining = 120;
  noticeSent = true;

  // 전체 공지 1번
  io.emit("notice", "9996", "X와의 채팅을 시작합니다. 2분 동안 X에게 질문을 남겨주세요.");

  tickTimer = setInterval(() => {
    remaining -= 1;
    if (remaining < 0) remaining = 0;

    io.emit("tick", remaining);

    if (remaining === 0) {
      locked = true;
      io.emit("locked", true);
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }, 1000);
}

io.on("connection", (socket) => {
  socket.on("join", (rawNickname) => {
    const input = String(rawNickname || "").trim();
    if (!input) return;

    // ✅ 관리자 규칙: 이름 앞에 9996 붙이면 관리자
    // 9996홍길동 / 9996-홍길동 / 9996:홍길동 / 9996 홍길동
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

    // ✅ 첫 접속이 들어오면 세션 시작
    startSessionIfNeeded();

    // 접속 메시지(삼각형 없음)
    io.emit("system", `${displayName}님이 접속했습니다.`);
    io.emit("count", Object.keys(users).length);

    // 관리자 플래그(클라 표시 안 함)
    if (isAdmin) socket.emit("admin", true);

    // 새로 들어온 사람에게 현재 상태 전달
    socket.emit("tick", remaining);
    socket.emit("locked", locked);

    // 공지는 "전체 1번" 이미 나갔지만, 새 유저는 못 봤을 수 있으니 1번만 개인에게 재전송
    if (noticeSent) {
      socket.emit("notice", "9996", "X와의 채팅을 시작합니다. 2분 동안 X에게 질문을 남겨주세요.");
    }
  });

  socket.on("chat", (msg) => {
    const text = String(msg || "").trim();
    if (!text) return;

    // ✅ 잠금이면: 관리자만 통과
    if (locked && !socket.isAdmin) return;

    // ✅ 24시간 HH:MM (오전/오후 없음)
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