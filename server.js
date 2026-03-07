const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const ADMIN_PREFIX = "9996";
let usersById = {}; // socket.id -> { name, isAdmin }

let timer = {
  duration: 120,
  remaining: 120,
  running: false,
  locked: false,
  interval: null,
};

// 정답/선택 상태
let answerState = {
  correct: "",          // "재회" | "환승"
  selectionOpen: false, // /선택 후 true
  adminName: "",        // 표시용 관리자명
};

function resetAnswerState() {
  answerState.correct = "";
  answerState.selectionOpen = false;
  answerState.adminName = "";
}

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
  io.emit("state", {
    remaining: timer.remaining,
    locked: timer.locked,
    running: timer.running,
  });
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
  io.emit("ended", reason);
}

function resetTimer() {
  stopTimer();
  timer.remaining = timer.duration;
  timer.locked = false;
  resetAnswerState();
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
    timer.remaining -= 1;
    if (timer.remaining < 0) timer.remaining = 0;

    io.emit("tick", timer.remaining);

    if (timer.remaining === 0) {
      lockRoomAndEnd("시간이 종료되었습니다.");
    }
  }, 1000);
}

function fastForward(seconds) {
  const s = Math.max(1, Math.min(9999, Number(seconds) || 1));
  timer.remaining = Math.max(0, timer.remaining - s);
  io.emit("tick", timer.remaining);
  emitState();

  if (timer.remaining === 0) {
    lockRoomAndEnd("관리자에 의해 종료되었습니다.");
  }
}

io.on("connection", (socket) => {
  socket.on("join", (rawNick) => {
    const raw = String(rawNick || "").trim();
    if (!raw) return;

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

  socket.on("req_users", () => {
    socket.emit("users", userList());
  });

  socket.on("typing", (v) => {
    const me = usersById[socket.id];
    if (!me) return;
    socket.broadcast.emit("typing", v ? `${me.name}님 입력중...` : "");
  });

  socket.on("chat", (msgRaw) => {
    const me = usersById[socket.id];
    if (!me) return;

    const msg = String(msgRaw || "");
    const trimmed = msg.trim();

    // ===== 관리자 명령어 =====
    if (me.isAdmin && trimmed.startsWith("/")) {
      const parts = trimmed.split(/\s+/);
      const cmd = parts[0];
      const arg = parts.slice(1).join(" ").trim();

      if (cmd === "/초기화") {
        io.emit("clear");
        io.emit("system", `[공지] 채팅 로그가 초기화되었습니다.`);
        return;
      }

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
        io.sockets.sockets.get(targetId)?.disconnect(true);
        return;
      }

      if (cmd === "/시작") {
        io.emit("system", `[공지] 타이머가 시작되었습니다.`);
        startTimer();
        return;
      }

      if (cmd === "/리셋") {
        resetTimer();
        return;
      }

      if (cmd === "/종료") {
        resetAnswerState();
        io.emit("system", `[공지] 관리자에 의해 채팅이 종료되었습니다.`);
        lockRoomAndEnd("관리자에 의해 채팅이 종료되었습니다.");
        return;
      }

      if (cmd === "/가속") {
        const n = parseInt(arg || "1", 10);
        if (Number.isNaN(n) || n <= 0) {
          socket.emit("system", `[공지] 사용법: /가속 10`);
          return;
        }
        fastForward(n);
        io.emit("system", `[공지] 시간이 ${n}초 가속되었습니다.`);
        return;
      }

      if (cmd === "/팝업끄기") {
        if (!arg) {
          io.emit("hideOverlay");
          socket.emit("system", `[공지] 모든 사용자의 팝업을 닫았습니다.`);
          return;
        }

        const targetId = Object.keys(usersById).find((id) => usersById[id].name === arg);
        if (!targetId) {
          socket.emit("system", `[공지] "${arg}" 사용자를 찾을 수 없습니다.`);
          return;
        }

        io.to(targetId).emit("hideOverlay");
        socket.emit("system", `[공지] "${arg}" 사용자의 팝업을 닫았습니다.`);
        return;
      }

      if (cmd === "/정답") {
        if (!arg) {
          socket.emit("system", `[공지] 사용법: /정답 재회 또는 /정답 환승`);
          return;
        }
        if (arg !== "재회" && arg !== "환승") {
          socket.emit("system", `[공지] 정답은 "재회" 또는 "환승"만 가능합니다.`);
          return;
        }

        answerState.correct = arg;
        answerState.selectionOpen = false;
        answerState.adminName = me.name;

        socket.emit("system", `[공지] 정답이 "${arg}"로 설정되었습니다.`);
        return;
      }

      if (cmd === "/선택") {
      if (!answerState.correct) {
        socket.emit("system", `[공지] 먼저 /정답 재회 또는 /정답 환승 으로 정답을 설정해주세요.`);
        return;
      }

      // 팝업 닫기 + 타이머 리셋 + 잠금 해제
      resetTimer();
      io.emit("hideOverlay");

      answerState.selectionOpen = true;
      answerState.adminName = me.name;

      io.emit("notice", "", "최종 선택지를 고르세요.\n> 재회\n> 환승");
      return;
    }

      socket.emit(
        "system",
        `[공지] 명령어: /시작 /리셋 /초기화 /퇴장 닉네임 /가속 10 /종료 /팝업끄기 /정답 재회|환승 /선택`
      );
      return;
    }

    // 일반 유저는 잠금이면 차단, 관리자는 가능
    if (timer.locked && !me.isAdmin) return;

    // ===== 최종 선택 판정 =====
    if (
      answerState.selectionOpen &&
      !me.isAdmin &&
      (trimmed === "재회" || trimmed === "환승")
    ) {
      if (trimmed === answerState.correct) {
        io.emit(
          "notice",
          "",
          "최종 커플 백선우♥이세웅\n축하드립니다. 스탬프를 받아가세요."
        );
      } else {
        io.emit(
          "notice",
          "",
          `최종 선택 ${answerState.adminName} > ${me.name}\n최종 커플 실패. 잠시 후 다시 도전해 주세요.`
        );
      }

      answerState.selectionOpen = false;
      return;
    }

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