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

// ===== 세션 타이머 상태(서버 단일) =====
const TOTAL = 120;
let remaining = TOTAL;
let running = false; // ✅ /시작으로만 true
let locked = false;
let tickTimer = null;

// ===== 타이핑 표시 =====
let typingUsers = new Set(); // socket.id
let typingTimerById = new Map(); // socket.id -> timeout

function emitState(toSocket = null) {
  const payload = { remaining, running, locked };
  if (toSocket) toSocket.emit("state", payload);
  else io.emit("state", payload);
}

function stopTimer() {
  running = false;
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  emitState();
}

function startTimer() {
  if (running) return;
  if (locked) return;
  running = true;

  tickTimer = setInterval(() => {
    remaining -= 1;
    if (remaining < 0) remaining = 0;

    io.emit("tick", remaining);

    if (remaining === 10) {
      // ✅ 효과음은 없앴고, 공지만 띄움
      io.emit("notice", "9996", "10초 남았습니다.");
    }

    if (remaining === 0) {
      locked = true;
      io.emit("locked", true);
      stopTimer(); // running false + interval 정리 + state 방송
    }
  }, 1000);

  emitState();
}

function resetTimer() {
  remaining = TOTAL;
  locked = false;
  stopTimer(); // running false + interval 정리
  io.emit("locked", false);
  io.emit("tick", remaining);
  io.emit("notice", "9996", "시간이 리셋되었습니다. /시작 으로 다시 시작할 수 있습니다.");
  emitState();
}

// 타이핑 방송
function broadcastTyping() {
  const names = [];
  for (const id of typingUsers) {
    const n = users[id];
    if (n) names.push(n);
  }
  let text = "";
  if (names.length === 1) text = `${names[0]} 입력 중...`;
  else if (names.length === 2) text = `${names[0]}, ${names[1]} 입력 중...`;
  else if (names.length >= 3) text = `${names[0]}, ${names[1]} 외 ${names.length - 2}명 입력 중...`;

  io.emit("typing", text);
}

function parseNickname(raw) {
  const input = String(raw || "").trim();
  if (!input) return null;

  let isAdmin = false;
  let displayName = input;

  // 이름 앞에 9996 붙이면 관리자(표시는 숨김)
  if (input.startsWith("9996")) {
    isAdmin = true;
    displayName = input.replace(/^9996[\s:\-]*/, "").trim();
    if (!displayName) displayName = "관리자";
  }
  return { isAdmin, displayName };
}

io.on("connection", (socket) => {
  socket.on("join", (rawNickname) => {
    const parsed = parseNickname(rawNickname);
    if (!parsed) return;

    socket.isAdmin = parsed.isAdmin;
    socket.nickname = parsed.displayName;
    users[socket.id] = parsed.displayName;

    io.emit("system", `${parsed.displayName}님이 접속했습니다.`);
    io.emit("count", Object.keys(users).length);

    if (socket.isAdmin) socket.emit("admin", true);

    // ✅ 접속자에게 현재 타이머 상태를 그대로 공유
    emitState(socket);
    socket.emit("tick", remaining);
    socket.emit("locked", locked);
    socket.emit("typing", "");
    socket.emit("notice", "9996", "X와의 채팅을 시작합니다. 관리자가 /시작 을 입력하면 2분이 시작됩니다.");
  });

  socket.on("chat", (msg) => {
    const text = String(msg || "").trim();
    if (!text) return;

    // join 전이면 무시
    if (!users[socket.id]) return;

    // 잠금이면 관리자만 가능
    if (locked && !socket.isAdmin) return;

    // ✅ 관리자 명령어
    if (socket.isAdmin && text.startsWith("/")) {
      if (text === "/시작") {
        if (locked) {
          socket.emit("notice", "9996", "이미 종료되었습니다. /리셋 후 /시작 해주세요.");
          return;
        }
        if (running) {
          socket.emit("notice", "9996", "이미 진행 중입니다.");
          return;
        }
        io.emit("notice", "9996", "타이머가 시작되었습니다.");
        startTimer();
        return;
      }

      if (text === "/리셋") {
        resetTimer();
        return;
      }

      if (text === "/정지") {
        stopTimer();
        io.emit("notice", "9996", "타이머가 정지되었습니다.");
        return;
      }
      // 다른 /명령어는 일반 채팅으로도 안 보내고 무시(원하면 안내로 바꿔도 됨)
      socket.emit("notice", "9996", "사용 가능한 명령어: /시작 /리셋 /정지");
      return;
    }

    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const time = `${hh}:${mm}`;

    io.emit("chat", socket.nickname || "익명", text, time);
  });

  // 타이핑
  socket.on("typing", (isTyping) => {
    if (!users[socket.id]) return;

    if (isTyping) {
      typingUsers.add(socket.id);

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