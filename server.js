// server.js
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ====== 상태 ======
const ADMIN_PREFIX = "9996"; // 닉네임이 9996으로 시작하면 관리자(표시는 제거)
let usersById = {};          // socket.id -> { name, isAdmin }

// 타이머(공유)
let timer = {
  duration: 120,
  remaining: 120,
  running: false,
  locked: false,
  interval: null,
};

function userList() {
  return Object.values(usersById).map((u) => u.name);
}
function countUsers() {
  return Object.keys(usersById).length;
}
function emitUsers() {
  io.emit("users", userList());
  io.emit("count", countUsers());
}
function emitState() {
  io.emit("state", { remaining: timer.remaining, locked: timer.locked, running: timer.running });
}

function stopTimer() {
  if (timer.interval) clearInterval(timer.interval);
  timer.interval = null;
  timer.running = false;
}

function resetTimer() {
  stopTimer();
  timer.remaining = timer.duration;
  timer.locked = false;
  emitState();
  io.emit("tick", timer.remaining);
  io.emit("locked", false);
  io.emit("system", `[공지] 타이머가 리셋되었습니다.`);
}

function startTimer() {
  if (timer.running) return;
  timer.running = true;
  timer.locked = false;
  emitState();

  timer.interval = setInterval(() => {
    if (!timer.running) return;

    timer.remaining -= 1;
    if (timer.remaining < 0) timer.remaining = 0;

    io.emit("tick", timer.remaining);

    if (timer.remaining === 0) {
      timer.locked = true;
      emitState();
      io.emit("locked", true);
      io.emit("ended"); // ✅ 종료 연출 트리거
      stopTimer();
    }
  }, 1000);
}

function timeStr() {
  // 오전/오후 없이 HH:MM
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

io.on("connection", (socket) => {
  socket.on("join", (rawNick) => {
    const raw = String(rawNick || "").trim();
    if (!raw) return;

    // ✅ 관리자 숨김: 9996 접두사면 관리자 / 표시용 이름에서는 제거
    let isAdmin = false;
    let name = raw;
    if (raw.startsWith(ADMIN_PREFIX)) {
      isAdmin = true;
      name = raw.replace(/^9996\s*/, "").trim();
      if (!name) name = "관리자";
    }

    usersById[socket.id] = { name, isAdmin };
    if (isAdmin) socket.emit("admin");

    emitUsers();
    emitState();
    socket.emit("tick", timer.remaining);
    socket.emit("locked", timer.locked);

    // 접속 메시지 (삼각형 하나만)
    io.emit("system", `[${timeStr()}] ▶ ${name}님이 접속했습니다.`);

    // 공지 (9996 텍스트 제거)
    socket.emit("notice", "", "X와의 채팅을 시작합니다. 2분 동안 X에게 질문을 남겨주세요.");
  });

  // ✅ 접속자 목록(F2) 요청
  socket.on("req_users", () => {
    socket.emit("users", userList());
  });

  // 타이핑 표시
  socket.on("typing", (v) => {
    const me = usersById[socket.id];
    if (!me) return;
    if (v) socket.broadcast.emit("typing", `${me.name}님 입력중...`);
    else socket.broadcast.emit("typing", "");
  });

  socket.on("chat", (msgRaw) => {
    const me = usersById[socket.id];
    if (!me) return;

    const msg = String(msgRaw || "");

    // ✅ 관리자 명령어
    if (me.isAdmin && msg.trim().startsWith("/")) {
      const parts = msg.trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(" ");

      if (cmd === "/clear") {
        io.emit("clear");
        io.emit("system", `[공지] 채팅 로그가 초기화되었습니다.`);
        return;
      }

      if (cmd === "/kick") {
        // ✅ 영구 강퇴 X : 현재 연결만 끊기
        const targetName = arg.trim();
        if (!targetName) {
          socket.emit("system", `[공지] 사용법: /kick 닉네임`);
          return;
        }
        const targetId = Object.keys(usersById).find((id) => usersById[id].name === targetName);
        if (!targetId) {
          socket.emit("system", `[공지] "${targetName}" 사용자를 찾을 수 없습니다.`);
          return;
        }
        if (usersById[targetId].isAdmin) {
          socket.emit("system", `[공지] 관리자는 킥할 수 없습니다.`);
          return;
        }

        io.to(targetId).emit("kicked", "관리자에 의해 퇴장되었습니다.");
        const s = io.sockets.sockets.get(targetId);
        if (s) s.disconnect(true);
        return;
      }

      if (cmd === "/start") {
        io.emit("system", `[공지] 타이머가 시작되었습니다.`);
        startTimer();
        return;
      }

      if (cmd === "/reset") {
        resetTimer();
        return;
      }

      socket.emit("system", `[공지] 알 수 없는 명령어: ${cmd}`);
      return;
    }

    // ✅ 일반 유저는 잠금이면 차단 (관리자는 가능)
    if (timer.locked && !me.isAdmin) return;

    io.emit("chat", me.name, msg, timeStr());
  });

  socket.on("disconnect", () => {
    const me = usersById[socket.id];
    if (!me) return;

    delete usersById[socket.id];
    emitUsers();

    io.emit("system", `[${timeStr()}] ◀ ${me.name}님이 퇴장했습니다.`);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("서버 실행중", PORT));