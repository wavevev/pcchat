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

// 세션/타이머(2분) 상태
let sessionStarted = false;
let locked = false;
let remaining = 120;
let tickTimer = null;
let noticeSent = false;

// 타이핑 표시용
let typingUsers = new Set(); // socket.id
let typingTimerById = new Map(); // socket.id -> timeout

function broadcastTyping() {
  const names = [];
  for (const id of typingUsers) {
    const n = users[id];
    if (n) names.push(n);
  }
  // 너무 길어지면 2명까지만 + n명…
  let text = "";
  if (names.length === 1) text = `${names[0]} 입력 중...`;
  else if (names.length === 2) text = `${names[0]}, ${names[1]} 입력 중...`;
  else if (names.length >= 3) text = `${names[0]}, ${names[1]} 외 ${names.length - 2}명 입력 중...`;

  io.emit("typing", text);
}

function startSessionIfNeeded() {
  if (sessionStarted) return;
  sessionStarted = true;
  locked = false;
  remaining = 120;
  noticeSent = true;

  io.emit("notice", "9996", "X와의 채팅을 시작합니다. 2분 동안 X에게 질문을 남겨주세요.");

  tickTimer = setInterval(() => {
    remaining -= 1;
    if (remaining < 0) remaining = 0;

    io.emit("tick", remaining);

    // ✅ 마지막 10초 경고(서버에서 1번만)
    if (remaining === 10) {
      io.emit("warn10");
      io.emit("notice", "9996", "10초 남았습니다.");
    }

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

    // 관리자 규칙: 이름 앞에 9996 붙이면 관리자 (표시에는 숨김)
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

    startSessionIfNeeded();

    io.emit("system", `${displayName}님이 접속했습니다.`);
    io.emit("count", Object.keys(users).length);

    if (isAdmin) socket.emit("admin", true);

    // 새 유저에게 현재 상태 전달
    socket.emit("tick", remaining);
    socket.emit("locked", locked);

    // 공지: 전체로 이미 나갔지만, 새 유저가 못 봤을 수 있어서 1번 개인 재전송
    if (noticeSent) {
      socket.emit("notice", "9996", "X와의 채팅을 시작합니다. 2분 동안 X에게 질문을 남겨주세요.");
    }

    // 타이핑 상태 동기화
    socket.emit("typing", "");
  });

  socket.on("chat", (msg) => {
    const text = String(msg || "").trim();
    if (!text) return;

    if (locked && !socket.isAdmin) return;

    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const time = `${hh}:${mm}`;

    io.emit("chat", socket.nickname || "익명", text, time);
  });

  // ✅ 타이핑(클라에서 주기적으로 ping)
  socket.on("typing", (isTyping) => {
    // join 전이면 무시
    if (!users[socket.id]) return;

    // 타이핑 true면 추가 + 2초 뒤 자동 해제
    if (isTyping) {
      typingUsers.add(socket.id);

      // 기존 타이머 갱신
      if (typingTimerById.has(socket.id)) clearTimeout(typingTimerById.get(socket.id));

      const t = setTimeout(() => {
        typingUsers.delete(socket.id);
        typingTimerById.delete(socket.id);
        broadcastTyping();
      }, 2000);

      typingTimerById.set(socket.id, t);
      broadcastTyping();
    } else {
      typingUsers.delete(socket.id);
      if (typingTimerById.has(socket.id)) {
        clearTimeout(typingTimerById.get(socket.id));
        typingTimerById.delete(socket.id);
      }
      broadcastTyping();
    }
  });

  socket.on("disconnect", () => {
    const name = users[socket.id];
    if (name) {
      io.emit("system", `${name}님이 퇴장했습니다.`);
      delete users[socket.id];
      io.emit("count", Object.keys(users).length);
    }

    // 타이핑 정리
    typingUsers.delete(socket.id);
    if (typingTimerById.has(socket.id)) {
      clearTimeout(typingTimerById.get(socket.id));
      typingTimerById.delete(socket.id);
    }
    broadcastTyping();
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("서버 실행중");
});