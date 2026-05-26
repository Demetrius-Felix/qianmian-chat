import { io, type Socket } from "socket.io-client";
import { SERVER_URL } from "./config";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, {
      transports: ["websocket"],
      autoConnect: true,
    });
  }
  return socket;
}

