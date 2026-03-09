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

const ADMIN_PREFIX = "9996";
let usersById = {}; // socket.id -> { name, isAdmin }

let timer = {
  duration: 120,
  remaining: 120,
  running: false,
  locked: false,
  interval: null,
};

const JUWAN_QUESTIONS = [
  "형이 나한테 선물했던 책 제목이 뭐였지?",
  "형이 예전에 우리 호떡이 이름 잘못 불렀잖아 뭐라고 불렀었지?",
  "우리 첫 2인 팬미팅 했던 나라 어디였더라?",
  "형 내 생년월일 맞혀 봐",
  "우리 집 고양이 이름 기억하지?",
  "전에 형이 해 준 음식 중에 내가 100점 줬던 거 있잖아 그거 뭐였지?",
  "내가 좋아하는 빵 뭔지 알지? 전에 형이 압수하겠다 했던 거",
  "웅이랑 나랑 좋아하는 색 똑같잖아 어떤 색인지 알지?",
  "내가 화이트데이 때 형한테 어떤 거 줬는지 기억나?",
  "예전에 형이 이불 덮어줬던 인형 어떤 동물이었는지 기억해?",
  "우리 같이 했던 마지막 팬미팅 풀네임이 뭐였더라?",
  "형이랑 같이 먹은 회 맛있었는데 그거 무슨 회였더라?",
  "형 나 핸드폰에 뭐라고 저장했어?",
  "내가 전에 웅이한테 과일 먹으러 오라고 했었잖아 무슨 과일이었는지 기억하지?",
  "내가 알려준 필터 이름 기억해?",
  "보석함에서 잘린 부분이 좀 있는데… 내가 그때 이상형 뭐라고 했었는지 기억해?",
  "형이 내 고독방 와서 음성메시지 뭐라고 남겼더라?",
  "연지구 글램핑 때 내가 형한테 그 노래 불러 줬었잖아 뭐였지?",
  "형이 나 뭉찬 팀 이름 잘못 말했잖아 ㅋㅋㅋ 뭐라고 했었더라?",
  "내 왼쪽 눈에 없는 게 뭐야?"
];

const TAEBIN_QUESTIONS = [
  "내가 너한테 선물해 준 책 제목 기억해?",
  "예전에 내가 호떡이 이름 잘못 불렀었는데 뭐라고 했었더라",
  "우리 첫 2인 팬미팅 했던 나라 어디였지?",
  "너 내 생년월일 언제인지 알아?",
  "우리 집 고양이 두 마리 이름 기억해?",
  "내가 너한테 해 준 음식 중에 네가 100점 줬던 음식 이름 뭔지 기억해?",
  "네가 좋아하는 빵 뭐였더라? 내가 전에 압수하겠다고 했던 거",
  "너도 좋아하고 나도 좋아하는 색깔",
  "화이트데이 때 네가 나한테 어떤 거 선물했더라?",
  "내가 예전에 이불 덮어줬던 인형 어떤 동물이었지?",
  "우리 같이 했던 마지막 팬미팅 풀네임 뭐였지?",
  "내 핸드폰에 너 뭐라고 저장되어 있는지 알아?",
  "네가 전에 나 보고 과일 먹으러 오라고 했었는데 그거 무슨 과일이었지?",
  "네가 알려준 필터 이름 뭐였더라?",
  "보석함에서 네가 이상형 그 동물이라고 했다며 뭐였더라? 그…",
  "내가 네 고독방 가서 음성메시지 뭐라고 남겼는지 기억나?",
  "연지구 글램핑에서 네가 나한테 노래 불러 줬었는데 제목이 뭐였지?",
  "내가 너 뭉찬 팀 이름 실수로 잘못 말했었는데 뭐라고 했었더라?",
  "너 왼쪽 눈에 없는 거 뭐였지?"
];

function getKSTTimeString() {
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
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

function unlockRoom() {
  timer.locked = false;
  stopTimer();
  emitState();
  io.emit("locked", false);
  io.emit("hideOverlay");
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

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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

    if (isAdmin) {
      socket.emit("admin");
    }

    emitUsers();
    emitState();
    socket.emit("tick", timer.remaining);
    socket.emit("locked", timer.locked);

    io.emit("system", `[${getKSTTimeString()}] ▶ ${name}님이 접속했습니다.`);
    socket.emit("notice", "", "X와의 채팅을 시작합니다. X의 세 가지 질문에 대답해 주세요.");
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

      if (cmd === "/주완") {
        io.emit("chat", me.name, pickRandom(JUWAN_QUESTIONS), getKSTTimeString());
        return;
      }

      if (cmd === "/태빈") {
        io.emit("chat", me.name, pickRandom(TAEBIN_QUESTIONS), getKSTTimeString());
        return;
      }

      if (cmd === "/성공") {
        unlockRoom();
        io.emit(
          "notice",
          "",
          "최종 커플 백선우♥이세웅\n축하드립니다. 채팅룸 밖 관리자로부터 스탬프를 받아주세요."
        );
        io.emit("resultRefresh", { type: "success", delay: 10 });
        return;
      }

      if (cmd === "/실패") {
        unlockRoom();
        io.emit(
          "notice",
          "",
          "최종 커플 매칭 실패.\n잠시 후 다시 채팅룸을 찾아와 주세요."
        );
        io.emit("resultRefresh", { type: "fail", delay: 10 });
        return;
      }

      socket.emit(
        "system",
        `[공지] 명령어: /시작 /리셋 /초기화 /퇴장 닉네임 /가속 10 /종료 /팝업끄기 /주완 /태빈 /성공 /실패`
      );
      return;
    }

    if (timer.locked && !me.isAdmin) return;

    io.emit("chat", me.name, msg, getKSTTimeString());
  });

  socket.on("disconnect", () => {
    const me = usersById[socket.id];
    if (!me) return;

    delete usersById[socket.id];
    emitUsers();

    io.emit("system", `[${getKSTTimeString()}] ◀ ${me.name}님이 퇴장했습니다.`);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("서버 실행중", PORT));