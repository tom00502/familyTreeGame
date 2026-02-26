# 斷線重連機制

本文檔詳細描述 WebSocket 斷線檢測、自動重連、狀態恢復的完整實現。

---

## 🔌 連線狀態管理

### 連線狀態機

```
[初始化]
  ↓
未連線 (CONNECTING)
  ├─ 建立 WebSocket 連線
  ├─ 等待 onopen 事件
  └─ 超時 30 秒 → ERROR
  ↓
[連線成功]
  ↓
已連線 (CONNECTED)
  ├─ 每 30 秒送心跳
  ├─ 接收伺服器消息
  └─ 心跳超時檢測啟動
  ↓
[心跳無回應或連線中斷]
  ↓
斷線 (DISCONNECTED)
  ├─ 記錄斷線時間
  ├─ 啟動重連倒數
  ├─ 保留待確認消息
  └─ 尋試自動重連
  ↓
[重連成功]
  ├─ 恢復尚未同步的狀態
  ├─ 重新發送待確認訊息
  └─ 同步房間完整狀態
  ↓
回到 CONNECTED
  ↓
[重試次數耗盡]
  ↓
永久失連 (FAILED)
  ├─ 顯示使用者提示
  ├─ 建議重新整理頁面
  └─ 記錄錯誤日誌
```

---

## 💓 心跳檢測機制

### 伺服器端心跳輪詢

```typescript
const HEARTBEAT_INTERVAL = 30 * 1000; // 30 秒
const HEARTBEAT_TIMEOUT_COUNT = 2; // 2 次無回應判為離線

function startHeartbeatMonitor() {
  setInterval(() => {
    const now = Date.now();

    gameState.rooms.forEach((room) => {
      room.players.forEach((player) => {
        if (!player.isConnected) return;

        // 檢查距離上次心跳的時間
        const timeSinceLastBeat = now - player.lastHeartbeat;

        if (timeSinceLastBeat > HEARTBEAT_INTERVAL * HEARTBEAT_TIMEOUT_COUNT) {
          // 超過 60 秒無心跳，標記為離線
          console.log(`[心跳超時] 玩家 ${player.name} (${player.playerId})`);

          player.isConnected = false;
          player.lastHeartbeat = now; // 更新離線時間

          // 廣播玩家離線事件
          broadcastToRoom(room.roomId, {
            type: "player_offline",
            playerId: player.playerId,
            playerName: player.name,
            offlineAt: now,
          });

          // 若為房主，觸發轉移
          if (player.isHost) {
            handleOwnerDisconnection(room, player.playerId);
          }
        }
      });
    });
  }, HEARTBEAT_INTERVAL);
}
```

### 客戶端心跳發送

```typescript
// composables/useGameWebSocket.ts
const sendHeartbeat = () => {
  if (ws.value && ws.value.readyState === WebSocket.OPEN) {
    ws.value.send(
      JSON.stringify({
        type: "heartbeat",
        playerId: playerId.value,
        timestamp: Date.now(),
      }),
    );

    // 更新本地心跳時間
    lastHeartbeat.value = Date.now();
  }
};

const startHeartbeat = () => {
  heartbeatInterval.value = setInterval(() => {
    sendHeartbeat();
  }, 30 * 1000); // 每 30 秒
};

const stopHeartbeat = () => {
  if (heartbeatInterval.value) {
    clearInterval(heartbeatInterval.value);
  }
};
```

---

## 🔄 斷線檢測與通知

### 伺服器端偵測

```typescript
export default defineWebSocketHandler({
  close(peer) {
    const gamePeer = peer as GamePeer;

    console.log(`[連線關閉] Peer ID: ${peer.id}`);

    if (gamePeer.roomId && gamePeer.playerId) {
      const room = gameState.rooms.get(gamePeer.roomId);

      if (room) {
        const player = room.players.get(gamePeer.playerId);

        if (player) {
          // 標記玩家離線，但保留資料
          player.isConnected = false;
          player.socketId = ""; // 清除舊的 socket 連線

          console.log(`[玩家離線] ${player.name} ` + `(房間: ${room.roomId})`);

          // 廣播離線通知給房間內其他玩家
          broadcastToRoom(room.roomId, {
            type: "player_offline",
            playerId: player.playerId,
            playerName: player.name,
            timestamp: Date.now(),
          });

          // 若是房主，觸發轉移邏輯
          if (player.isHost && room.status === "waiting") {
            handleOwnerDisconnection(room, player.playerId);
          }
        }
      }
    }

    // 移除連線記錄
    connections.delete(peer.id);
  },
});
```

### 客戶端通知

```typescript
const setupWebSocketHandlers = () => {
  ws.value.onclose = (event) => {
    console.log(
      "[WebSocket] 連線已關閉",
      `Code: ${event.code}, Clean: ${event.wasClean}`,
    );

    isConnected.value = false;
    connectionStatus.value = "disconnected";

    if (!event.wasClean) {
      // 異常斷線
      showMessage("連線已中斷，正在嘗試重新連線...", "warning");
    }

    // 啟動自動重連
    if (shouldReconnect.value) {
      scheduleReconnect(0);
    }
  };

  ws.value.onerror = (error) => {
    console.error("[WebSocket] 連線錯誤:", error);
    connectionStatus.value = "error";
    showMessage("連線發生錯誤", "error");
  };
};
```

---

## 🔁 自動重連機制

### 重連延遲策略（指數退避）

```typescript
const RECONNECT_DELAYS = [
  3 * 1000, // 嘗試 1：3 秒
  4.5 * 1000, // 嘗試 2：4.5 秒
  6.75 * 1000, // 嘗試 3：6.75 秒
  10.125 * 1000, // 嘗試 4：10.125 秒
  15.1875 * 1000, // 嘗試 5：15.1875 秒
  22.78 * 1000, // 嘗試 6：22.78 秒
  34.17 * 1000, // 嘗試 7：34.17 秒
  51.26 * 1000, // 嘗試 8：51.26 秒
  76.89 * 1000, // 嘗試 9：76.89 秒
  115.34 * 1000, // 嘗試 10：115.34 秒（最後一次）
];

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_MULTIPLIER = 1.5; // 退避倍數

function getReconnectDelay(attemptNumber: number): number {
  if (attemptNumber < RECONNECT_DELAYS.length) {
    return RECONNECT_DELAYS[attemptNumber];
  }

  // 若超過預設列表，使用最後一個延遲時間
  return RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1];
}

function scheduleReconnect(attemptNumber: number) {
  if (attemptNumber >= MAX_RECONNECT_ATTEMPTS) {
    // 重連失敗，達到上限
    connectionStatus.value = "permanently_failed";
    showMessage("無法連線至伺服器，請檢查網路連線或重新整理頁面", "error");

    logger.error(`重連失敗: 已達最大嘗試次數 (${MAX_RECONNECT_ATTEMPTS})`);
    return;
  }

  const delay = getReconnectDelay(attemptNumber);

  console.log(
    `[重連排程] 嘗試 ${attemptNumber + 1}/${MAX_RECONNECT_ATTEMPTS}, ` +
      `延遲 ${(delay / 1000).toFixed(2)} 秒`,
  );

  reconnectTimeoutId.value = setTimeout(() => {
    connectWebSocket(attemptNumber + 1);
  }, delay);
}
```

### 重連執行

```typescript
function connectWebSocket(attemptNumber: number = 0) {
  try {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    console.log(
      `[WebSocket] 正在連線 (嘗試 ${attemptNumber + 1}/${MAX_RECONNECT_ATTEMPTS}): ${wsUrl}`,
    );

    ws.value = new WebSocket(wsUrl);

    // 連線成功
    ws.value.onopen = () => {
      console.log(`[WebSocket] 連線成功 (第 ${attemptNumber + 1} 次嘗試)`);

      isConnected.value = true;
      connectionStatus.value = "connected";
      reconnectAttempts.value = 0;

      // 若為重連，發送重連消息
      if (attemptNumber > 0) {
        handleReconnection();
      }

      // 啟動心跳
      startHeartbeat();

      // 同步房間狀態
      requestRoomStateSync();
    };

    // 已有監聽器設置在 setupWebSocketHandlers
    setupWebSocketHandlers();
  } catch (error) {
    logger.error(`[WebSocket] 連線發生異常:`, error);
    scheduleReconnect(attemptNumber + 1);
  }
}
```

---

## 🔀 重連後狀態恢復

### 識別舊玩家資訊

```typescript
function getStoredPlayerData() {
  const stored = localStorage.getItem("familyTreeGame");

  if (!stored) return null;

  try {
    return JSON.parse(stored) as {
      playerId: string;
      nodeId: string;
      lastRoomId: string;
      name: string;
      gender: string;
      birthday: string;
    };
  } catch (e) {
    logger.error("localStorage 資料損壞:", e);
    return null;
  }
}
```

### 重連申請

```typescript
function handleReconnection() {
  const storedData = getStoredPlayerData();

  if (!storedData || !storedData.lastRoomId) {
    console.warn("[重連] 無有效的儲存玩家資料");
    return;
  }

  // 發送重連申請
  console.log(
    `[重連] 尋求恢復玩家 ${storedData.name} ` +
      `(房間: ${storedData.lastRoomId})`,
  );

  send("member:join", {
    roomId: storedData.lastRoomId,
    playerId: storedData.playerId, // 提供舊的 playerId
    name: storedData.name,
    gender: storedData.gender,
    birthday: storedData.birthday,
  });
}
```

### 伺服器確認重連玩家

```typescript
// server/routes/ws.ts
if (data.type === "member:join") {
  const { roomId, playerId, name, gender, birthday } = data;
  const room = gameState.rooms.get(roomId);

  if (!room) {
    // 房間不存在
    peer.send(
      JSON.stringify({
        type: "error",
        code: "ROOM_NOT_FOUND",
        message: "房間不存在或已過期",
      }),
    );
    return;
  }

  let player: Player;

  // 檢查是否為重連玩家
  if (playerId && room.players.has(playerId)) {
    console.log(`[重連] 玩家 ${name} 已重連`);

    // 重連玩家
    player = room.players.get(playerId)!;
    player.socketId = peer.id;
    player.isConnected = true;
    player.lastHeartbeat = Date.now();
    player.connectionAttempts = 0;

    // 伺服器向重連玩家推送完整狀態
    peer.send(
      JSON.stringify({
        type: "player_registered",
        playerId: player.playerId,
        nodeId: player.nodeId,
        message: "已重連至房間",
        roomState: syncRoomState(room), // 完整房間狀態
      }),
    );

    // 廣播給房間內其他玩家
    broadcastToRoom(roomId, {
      type: "reconnected",
      playerId: player.playerId,
      playerName: player.name,
      reconnectedAt: Date.now(),
    });
  } else {
    // 新玩家加入邏輯
    const newPlayerId = crypto.randomUUID();
    const nodeId = crypto.randomUUID();

    player = {
      playerId: newPlayerId,
      socketId: peer.id,
      nodeId,
      name,
      gender,
      birthday: new Date(birthday),
      score: 0,
      isConnected: true,
      isObserver: false,
      isHost: room.players.size === 0, // 首位玩家為房主
      lastHeartbeat: Date.now(),
      joinedAt: Date.now(),
      lastActivityAt: Date.now(),
      contributions: {
        /* ... */
      },
    };

    room.players.set(newPlayerId, player);

    // ... 新玩家初始化邏輯
  }

  gamePeer.playerId = player.playerId;
  gamePeer.roomId = roomId;
  gamePeer.playerName = name;
  gamePeer.isOwner = player.isHost;

  // 同步房間狀態
  syncRoomState(room);
}
```

### 客戶端重連後狀態同步

```typescript
function handleReconnectionConfirm(data: any) {
  console.log("[重連確認] 玩家已重連:", data);

  // 更新本地玩家資訊
  playerId.value = data.playerId;
  nodeId.value = data.nodeId;

  // 恢復房間狀態
  if (data.roomState) {
    // 更新房間資訊
    currentRoomId.value = data.roomState.roomId;
    players.value = data.roomState.players;
    gameStatus.value = data.roomState.status;
    remainingTime.value = data.roomState.remainingTime;

    // 如遊戲進行中，恢復遊戲 UI
    if (data.roomState.status === "in-game") {
      gameStartTime.value = data.roomState.startTime;
      initializeGameUI();
    }
  }

  showMessage("已成功重新連線", "success");
}

// 監聽重連確認事件
ws.value.addEventListener("message", (event) => {
  try {
    const data = JSON.parse(event.data);

    if (data.type === "player_registered" && roomId.value) {
      // 這是重連後的確認
      handleReconnectionConfirm(data);
    }
  } catch (error) {
    console.error("訊息解析錯誤:", error);
  }
});
```

---

## 💾 待確認訊息隊列

### 緩衝未確認訊息

```typescript
interface PendingMessage {
  id: string; // 訊息 ID（去重用）
  type: string; // 訊息類型
  data: any; // 訊息資料
  sentAt: number; // 發送時間戳
  attempts: number; // 重試次數
}

let pendingMessages: PendingMessage[] = [];

function queueMessage(type: string, data: any) {
  if (isConnected.value) {
    // 連線中，直接發送
    send(type, data);
  } else {
    // 離線，加入隊列
    const msgId = crypto.randomUUID();

    pendingMessages.push({
      id: msgId,
      type,
      data,
      sentAt: Date.now(),
      attempts: 0,
    });

    console.log(
      `[待確認] 訊息已加入隊列 (${type}), 目前隊列大小: ${pendingMessages.length}`,
    );
  }
}

function flushPendingMessages() {
  console.log(`[重新發送] 發送 ${pendingMessages.length} 條待確認訊息`);

  const messagesToSend = [...pendingMessages];
  pendingMessages = [];

  messagesToSend.forEach((msg) => {
    msg.attempts++;

    console.log(`[重新發送] ${msg.type} (嘗試 ${msg.attempts})`);

    send(msg.type, msg.data);
  });
}

// 重連成功後刷新待確認訊息
function handleReconnection() {
  // ... 恢復玩家資訊邏輯 ...

  // 刷新待確認訊息
  setTimeout(() => {
    flushPendingMessages();
  }, 500); // 等待 500ms 確保連線穩定
}
```

---

## ⏱️ 超時控制

### 連線超時

```typescript
const CONNECTION_TIMEOUT = 30 * 1000; // 30 秒

function connectWebSocket(attemptNumber: number = 0) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws.value = new WebSocket(wsUrl);

  // 設置連線超時
  const connectionTimeoutId = setTimeout(() => {
    if (!isConnected.value) {
      console.warn("[超時] WebSocket 連線超時 (30 秒)");

      ws.value?.close();

      scheduleReconnect(attemptNumber + 1);
    }
  }, CONNECTION_TIMEOUT);

  ws.value.onopen = () => {
    // 清除超時計時器
    clearTimeout(connectionTimeoutId);
    isConnected.value = true;
    // ...
  };
}
```

---

## 📊 重連統計與日誌

### 記錄重連事件

```typescript
interface ReconnectionEvent {
  timestamp: number;
  playerId: string;
  roomId: string;
  attemptNumber: number;
  delayMs: number;
  success: boolean;
  reason?: string; // 斷線原因
}

const reconnectionLog: ReconnectionEvent[] = [];

function logReconnectionAttempt(
  attempt: number,
  success: boolean,
  reason?: string,
) {
  const event: ReconnectionEvent = {
    timestamp: Date.now(),
    playerId: playerId.value || "unknown",
    roomId: currentRoomId.value || "unknown",
    attemptNumber: attempt,
    delayMs: getReconnectDelay(attempt - 1),
    success,
    reason,
  };

  reconnectionLog.push(event);

  // 保持日誌大小在合理範圍（最多 100 條）
  if (reconnectionLog.length > 100) {
    reconnectionLog.shift();
  }
}
```

---

## 🛡️ 邊界情況處理

### 重連期間房間已關閉

```typescript
handle(reconnection where room is closed) {
  console.warn("[重連失敗] 房間已關閉");

  // 清除本地房間資訊
  localStorage.removeItem("familyTreeGame");
  currentRoomId.value = null;

  // 導向首頁
  router.push("/");

  showMessage("房間已關閉，請建立或加入新房間", "info");
}
```

### 重連期間房間狀態已變更

```typescript
function handleRoomStateChange(newState: string) {
  const oldState = gameStatus.value;

  // 如從 waiting 變為 in-game
  if (oldState === "waiting" && newState === "in-game") {
    console.log("[狀態變更] 遊戲已開始，更新 UI");
    initializeGameUI();
    gameStartTime.value = Date.now();
  }

  gameStatus.value = newState;
}
```

---

**文件版本**：1.0  
**最後更新**：2026-02-26
