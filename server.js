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

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running");
});
