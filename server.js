const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let userCount = 0;

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
userCount++;
io.emit("user count", userCount);

socket.on("join", (nickname) => {
socket.nickname = nickname;
io.emit("system message", `▶ ${nickname}님이 접속했습니다.`);
});

socket.on("chat message", (data) => {
socket.broadcast.emit("chat message", data);
});

socket.on("disconnect", () => {
userCount--;
io.emit("user count", userCount);
if (socket.nickname) {
io.emit("system message", `◀ ${socket.nickname}님이 퇴장했습니다.`);
}
});
});

server.listen(3000, () => {
console.log("http://localhost:3000 에서 실행 중 💙");
});
