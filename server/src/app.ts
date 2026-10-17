import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import type { ClientToServerEvents, ServerToClientEvents } from "ame-shared";
import adminRoutes from "./routes/admin.js";
import experimentRoutes from "./routes/experiment.js";
import uploadRoutes from "./routes/upload.js";
import { adminAssetRoutes, publicAssetRoutes } from "./routes/assets.js";
import { publicUploadRoutes } from "./routes/uploads.js";
import { adminErrorRoutes } from "./routes/errors.js";
import { setupSocketHandlers } from "./socket/index.js";
import { RedisWaitingRoomStore } from "./socket/redisWaitingRoomStore.js";
import { RedisChatStore } from "./socket/chatStore.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { installProcessErrorHandlers } from "./processErrorHandlers.js";
import { installDatabaseSink } from "./errors/databaseSink.js";
import { startErrorRetentionSweep } from "./errors/retention.js";

// installDatabaseSink() first: installProcessErrorHandlers() needs its
// {flush, stop} handle to flush buffered errors before an uncaughtException
// or SIGTERM/SIGINT exit, instead of losing them with the process.
const errorSink = installDatabaseSink();
installProcessErrorHandlers(errorSink);
startErrorRetentionSweep();

const IsProduction = process.env.NODE_ENV === "production";
const ClientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";
const RedisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
/**
 * The largest Socket.IO message, in bytes. A streaming recording sends a 3 s
 * chunk at a fixed 2.5 Mbit/s (`RecordingManager.ts`), about 1 MB, so this
 * leaves 4× margin. The 1 MB default closed the socket mid-recording; a much
 * larger limit lets any client make the server hold large messages.
 */
const MaxSocketMessageBytes = 4 * 1024 * 1024;

// Behind a reverse proxy, req.ip is the proxy unless Express is told to read
// X-Forwarded-For. Only in production, where a proxy is actually in front of
// us — trusting the header when nothing sets it would let any caller spoof
// their address.
const app = express();
if (IsProduction) app.set("trust proxy", 1);
const httpServer = createServer(app);

// Middleware
app.use(
  cors({
    origin: IsProduction ? ClientUrl : "*",
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));

// Root
app.get("/", (_req, res) => {
  res.json({ name: "AME API", version: "1.0.0", status: "ok" });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/admin", adminAssetRoutes);
app.use("/api/admin", adminErrorRoutes);
app.use("/api/assets", publicAssetRoutes);
app.use("/api/uploads", publicUploadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/experiment", experimentRoutes);
app.use("/api/upload", uploadRoutes);

// Must stay after every route: Express only reaches an error handler mounted
// after the route that failed.
app.use(errorHandler);

// Socket.IO
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  maxHttpBufferSize: MaxSocketMessageBytes,
  cors: {
    origin: IsProduction ? ClientUrl : "*",
    credentials: true,
  },
});

// Redis-backed Socket.IO adapter and waiting room store
const pubClient = new Redis(RedisUrl);
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));

const storeClient = new Redis(RedisUrl);
const waitingRoomStore = new RedisWaitingRoomStore(storeClient);
const chatStore = new RedisChatStore(storeClient);
console.log("[Server] Using Redis adapter and Redis waiting room store");

setupSocketHandlers(io, waitingRoomStore, chatStore);

export { app, httpServer, io };

// Start server if run directly
const Port = parseInt(process.env.PORT ?? "3001", 10);

httpServer.listen(Port, () => {
  console.log(`AME server running on port ${Port} (${IsProduction ? "production" : "development"})`);
});
