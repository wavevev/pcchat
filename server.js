// server.js
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ====== 설정 ======
const ADMIN_PREFIX = "9996"; // 닉네임이 9996으로 시작하면 관리자(표시에서는 제거)
let usersById = {};          // socket.id -> { name, isAdmin }

// 타이머(공유)
let timer = {
  duration: 120,
  remaining: 120,
  running: false,
  locked: false,
  interval: null,
};

// ===== 유틸 =====
function timeStr() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
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
function lockRoomAndEnd(reason = "시간이 종료되었습니다.") {
  timer.locked = true;
  stopTimer();
  emitState();
  io.emit("locked", true);
  io.emit("ended", reason); // 종료 연출
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
  if (timer.locked) return;
  timer.running = true;
  emitState();

  timer.interval = setInterval(() => {
    if (!timer.running) return;

    timer.remaining -= 1;
    if (timer.remaining < 0) timer.remaining = 0;

    io.emit("tick", timer.remaining);

    if (timer.remaining === 0) {
      lockRoomAndEnd("시간이 종료되었습니다.");
    }
  }, 1000);
}
function fastForward(seconds) {
  // seconds만큼 즉시 감소(0 미만 불가)
  const s = Math.max(1, Math.min(9999, Number(seconds) || 1));
  timer.remaining = Math.max(0, timer.remaining - s);
  io.emit("tick", timer.remaining);
  emitState();
  if (timer.remaining === 0) lockRoomAndEnd("관리자에 의해 종료되었습니다.");
}

// ===== 소켓 =====
io.on("connection", (socket) => {
  socket.on("join", (rawNick) => {
    const raw = String(rawNick || "").trim();
    if (!raw) return;

    // ✅ 관리자 숨김: 9996 접두사면 관리자 / 표시는 제거
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

    io.emit("system", `[${timeStr()}] ▶ ${name}님이 접속했습니다.`);
    socket.emit("notice", "", "X와의 채팅을 시작합니다. 2분 동안 X에게 질문을 남겨주세요.");
  });

  // 접속자 목록(F2)
  socket.on("req_users", () => socket.emit("users", userList()));

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
    const trimmed = msg.trim();

    // ===== 관리자 한국어 명령어 =====
    if (me.isAdmin && trimmed.startsWith("/")) {
      const parts = trimmed.split(/\s+/);
      const cmd = parts[0];
      const arg = parts.slice(1).join(" ").trim();

      // /초기화 : 채팅 로그 지우기
      if (cmd === "/초기화") {
        io.emit("clear");
        io.emit("system", `[공지] 채팅 로그가 초기화되었습니다.`);
        return;
      }

      // /퇴장 닉네임 : 현재 접속만 끊기(영구강퇴 X)
      if (cmd === "/퇴장") {
        if (!arg) {
          socket.emit("system", `[공지] 사용법: /퇴장 닉네임`);
          return;
        }
        const targetId = Object.keys(usersById).find((id) => usersById[id].name === arg);
        if (!targetId) {
          socket.emit("system", `[공지] "${arg}" 사용자를 찾을 수 없습니다.`);
          return;
        }
        if (usersById[targetId].isAdmin) {
          socket.emit("system", `[공지] 관리자는 퇴장시킬 수 없습니다.`);
          return;
        }
        io.to(targetId).emit("kicked", "관리자에 의해 퇴장되었습니다.");
        const s = io.sockets.sockets.get(targetId);
        if (s) s.disconnect(true);
        return;
      }

      // /시작 : 타이머 시작
      if (cmd === "/시작") {
        io.emit("system", `[공지] 타이머가 시작되었습니다.`);
        startTimer();
        return;
      }

      // /리셋 : 타이머 리셋
      if (cmd === "/리셋") {
        resetTimer();
        return;
      }

      // /종료 : 즉시 종료 + 전체 잠금(관리자만 채팅 가능은 유지될 수도 있지만, 여기서는 잠금만)
      if (cmd === "/종료") {
        io.emit("system", `[공지] 관리자에 의해 채팅이 종료되었습니다.`);
        lockRoomAndEnd("관리자에 의해 채팅이 종료되었습니다.");
        return;
      }

      // /가속 10 : 남은 시간을 10초만큼 즉시 줄임 (빨리 지나가게)
      if (cmd === "/가속") {
        const n = parseInt(arg || "1", 10);
        if (Number.isNaN(n) || n <= 0) {
          socket.emit("system", `[공지] 사용법: /가속 10 (초 단위)`);
          return;
        }
        fastForward(n);
        io.emit("system", `[공지] 시간이 ${n}초 가속되었습니다.`);
        return;
      }

      socket.emit("system", `[공지] 사용 가능한 명령어: /시작 /리셋 /초기화 /퇴장 닉네임 /가속 10 /종료`);
      return;
    }

    // 일반 유저는 잠금이면 차단(관리자는 가능)
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