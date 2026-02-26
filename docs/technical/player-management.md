# 玩家管理與房主轉移

本文檔詳細描述玩家的完整生命週期、狀態轉換、房主轉移邏輯等伺服器端實現細節。

---

## 👥 玩家生命週期

```
[玩家訪問應用]
  ↓
未連線 (Unconnected)
  │ ├─ 首次訪問：生成新 playerId
  │ └─ 舊訪客：讀取 localStorage 中的 playerId
  ↓
[玩家加入房間]
  ↓
已連線 (Connected)
  ├─ 正常遊戲狀態
  ├─ 心跳檢測啟動（30 秒一次）
  └─ 可接收題目、派發任務
  ↓
[玩家離線或連線中斷]
  ↓
離線 (Disconnected)
  ├─ 保留玩家資料與進度
  ├─ 標記為「離線」
  ├─ 心跳重試（最多 10 次，指數退避）
  └─ 超過 5 分鐘無回應 → 視為永久離線
  ↓
[玩家重連或退出房間]
  ↓
離開 (Left) 或銷毀 (Destroyed)
```

---

## 🆔 玩家身份管理

### playerId 生成與儲存

```typescript
function initializeOrRestorePlayer() {
  // 檢查 localStorage
  const stored = localStorage.getItem("familyTreeGame");

  if (stored) {
    // 返回玩家
    const playerData = JSON.parse(stored);
    return playerData.playerId;
  } else {
    // 新玩家
    const playerId = crypto.randomUUID();

    // 存儲至 localStorage（等待玩家填寫資訊時更新）
    localStorage.setItem(
      "familyTreeGame",
      JSON.stringify({
        playerId,
        // 其他資訊在加入房間時更新
      }),
    );

    return playerId;
  }
}
```

### localStorage 資料結構

```json
{
  "playerId": "uuid-xxxx-yyyy", // 唯一識別符
  "nodeId": "uuid-node-xxxx", // 對應的族譜節點 ID
  "lastRoomId": "ABC12345", // 最後進入的房間
  "name": "王小明", // 玩家姓名
  "gender": "male", // 性別
  "birthday": "1990/01/15" // 出生日期
}
```

---

## 📊 玩家資料結構

```typescript
interface Player {
  // 身份識別
  playerId: string; // 唯一ID
  socketId: string; // WebSocket 連線 ID（伺服器端）
  nodeId: string; // 對應的族譜節點 ID

  // 基本信息
  name: string; // 2-10 字元中文姓名
  gender: "male" | "female"; // 性別
  birthday: Date; // 出生日期(YYYY/MM/DD)

  // 房間角色
  isHost: boolean; // 是否為房主
  isObserver: boolean; // 是否為旁觀者

  // 連線狀態
  isConnected: boolean; // 是否連線中
  lastHeartbeat: number; // 最後心跳時間戳
  connectionAttempts: number; // 重連試次計數

  // 遊戲進度
  score: number; // 累計積分
  contributions: {
    relationshipQuestions: number; // 完成的關係確認問題
    nodeNaming: number; // 命名節點貢獻
    attributeFilling: number; // 屬性填充貢獻
    nodeConvergence: number; // 節點匯聚貢獻
    ageOrdering: number; // 排序貢獻
  };

  // 元數據
  joinedAt: number; // 加入時間戳（用於房主轉移優先級）
  lastActivityAt: number; // 最後活動時間戳
}
```

---

## 🔄 玩家狀態機

### 狀態轉換圖

```
已連線 (Connected)
  │ ├─ 正常狀態：接收題目、派發任務
  │ ├─ 輸入狀態：玩家正在回答問題（任務鎖定）
  │ ├─ 類型："connected" | "typing"
  │ ├─ 心跳：30 秒一次
  │ └─ 超時判定：2 個連續心跳無回應
  │
  ╰─ [連線中斷或檢測失敗]
     │
     ↓
離線 (Disconnected, < 5 分鐘)
  │ ├─ 玩家資料保留
  │ ├─ 進度保留
  │ ├─ 任務保留（可被其他玩家搶答）
  │ ├─ 類型："offline"
  │ ├─ 心跳重試：指數退避（3s, 4.5s, 6.75s, ...）
  │ └─ 超時判定：10 次重試後
  │
  ├─ [玩家重連成功]
  │  ↓ 恢復連線、重新發送待確認訊息
  │  回到 Connected
  │
  └─ [離線超過 5 分鐘]
     │
     ↓
永久離線 (Permanently Offline, > 5 分鐘)
  ├─ 玩家資料清理（若不是 Final 遊戲）
  ├─ 進度保留用於排行榜
  ├─ 類型："permanently_offline"
  └─ 無自動恢復機制
```

---

## 💔 房主離線與轉移

### 房主轉移邏輯

#### 觸發條件

1. **檢測房主 WebSocket 連線關閉**
   - Client 端 WebSocket `onclose` 事件或 Server 端偵測心跳超時
   - 無延遲等待（根據選項決策：程式碼優先原則）

2. **房間狀態檢查**
   - 房間必須為 "waiting" 狀態（遊戲進行中不轉移）
   - 房間內至少有 1 位活躍玩家

#### 轉移流程

```typescript
function handleOwnerDisconnection(room: Room, ownerId: string) {
  // 1. 檢查房間狀態
  if (room.status !== "waiting") {
    // 遊戲進行中，不轉移權限
    // 直接標記房主為離線
    const owner = room.players.get(ownerId);
    if (owner) {
      owner.isConnected = false;
    }
    return;
  }

  // 2. 候選人篩選
  const candidates = Array.from(room.players.values()).filter((p) => {
    // 排除條件
    if (p.playerId === ownerId) return false; // 排除舊房主
    if (p.isObserver) return false; // 排除旁觀者
    if (!p.isConnected) return false; // 排除離線玩家
    return true;
  });

  // 3. 無候選人，房間關閉
  if (candidates.length === 0) {
    logger.info(`房間 ${room.roomId} 無活躍玩家，自動關閉`);
    gameState.rooms.delete(room.roomId);
    broadcastToRoom(room.roomId, {
      type: "room:closed",
      reason: "no_active_players",
    });
    return;
  }

  // 4. 按優先級選擇新房主
  // 優先級 1：最先加入房間（joinedAt 最早）
  const newOwner = candidates.reduce((earliest, current) => {
    return current.joinedAt < earliest.joinedAt ? current : earliest;
  });

  // 5. 更新房主身份
  const oldOwnerName = room.players.get(ownerId)?.name || "Unknown";
  room.hostId = newOwner.playerId;
  newOwner.isHost = true;

  // 舊房主標記
  const oldOwner = room.players.get(ownerId);
  if (oldOwner) {
    oldOwner.isHost = false;
    oldOwner.isConnected = false;
  }

  // 6. 廣播通知
  broadcastToRoom(room.roomId, {
    type: "owner_changed",
    oldOwnerId: ownerId,
    oldOwnerName,
    newOwnerId: newOwner.playerId,
    newOwnerName: newOwner.name,
    changedAt: Date.now(),
    reason: "owner_disconnection",
  });

  // 7. 日誌記錄
  logger.info(
    `房主轉移: 房間 ${room.roomId} ` + `${oldOwnerName} → ${newOwner.name}`,
  );
}
```

### 房主重連

```typescript
function handleOwnerReconnection(playerId: string, roomId: string) {
  const room = gameState.rooms.get(roomId);
  if (!room) return;

  const player = room.players.get(playerId);
  if (!player) return;

  // 檢查是否為原房主
  if (room.hostId !== playerId && player.isHost) {
    // 重新指定為房主
    room.hostId = playerId;
  }

  // 恢復連線狀態
  player.isConnected = true;
  player.lastHeartbeat = Date.now();

  // 廣播重連通知
  broadcastToRoom(roomId, {
    type: "reconnected",
    playerId,
    playerName: player.name,
    isHost: player.isHost,
  });

  // 若為房主，發送恢復通知
  if (player.isHost) {
    const peerConnection = connections.get(player.socketId);
    if (peerConnection) {
      peerConnection.send(
        JSON.stringify({
          type: "owner_restored",
          roomState: syncRoomState(room),
        }),
      );
    }
  }
}
```

---

## 💓 心跳檢測機制

### 心跳構造

```typescript
const heartbeatInterval = 30 * 1000; // 30 秒

setInterval(() => {
  gameState.rooms.forEach((room) => {
    room.players.forEach((player) => {
      if (!player.isConnected) return;

      // 檢查上次心跳時間
      const timeSinceLastHeartbeat = Date.now() - player.lastHeartbeat;

      if (timeSinceLastHeartbeat > heartbeatInterval * 2) {
        // 2 個心跳無回應，標記為離線
        player.isConnected = false;
        player.connectionAttempts = 0;

        broadcastToRoom(room.roomId, {
          type: "player_offline",
          playerId: player.playerId,
          playerName: player.name,
        });

        // 若房主離線，觸發轉移
        if (player.isHost) {
          handleOwnerDisconnection(room, player.playerId);
        }
      }
    });
  });
}, heartbeatInterval);
```

### 客戶端心跳回應

```typescript
ws.addEventListener("open", () => {
  // 定期發送心跳
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "heartbeat",
          playerId: currentPlayerId,
          timestamp: Date.now(),
        }),
      );
    }
  }, 30 * 1000);
});
```

---

## 🔁 重連機制

### 重連延遲策略（指數退避）

```typescript
const reconnectDelays = [
  3 * 1000, // 嘗試 1：3 秒
  4.5 * 1000, // 嘗試 2：4.5 秒
  6.75 * 1000, // 嘗試 3：6.75 秒
  10.125 * 1000, // 嘗試 4：10.125 秒
  // ... 最多 10 次嘗試
];

function scheduleReconnect(attemptNumber: number) {
  if (attemptNumber >= 10) {
    console.error("重連失敗，已達上限");
    showUserMessage("無法連線至伺服器，請重新整理頁面");
    return;
  }

  const delay =
    reconnectDelays[attemptNumber] ||
    reconnectDelays[reconnectDelays.length - 1] * 1.5;

  setTimeout(() => {
    connectWebSocket(attemptNumber + 1);
  }, delay);
}
```

### 重連狀態恢復

```typescript
function reconnect(storedPlayerData: StoredPlayerData) {
  // 使用 localStorage 中的資訊發起重連
  ws.send(
    JSON.stringify({
      type: "member:join",
      roomId: storedPlayerData.lastRoomId,
      playerId: storedPlayerData.playerId,
      name: storedPlayerData.name,
      gender: storedPlayerData.gender,
      birthday: storedPlayerData.birthday,
    }),
  );

  // 伺服器驗證並恢復玩家狀態
}
```

---

## 🎯 玩家狀態查詢與同步

### 獲取玩家當前狀態

```typescript
function getPlayerStatus(playerId: string, roomId: string) {
  const room = gameState.rooms.get(roomId);
  if (!room) return null;

  const player = room.players.get(playerId);
  if (!player) return null;

  return {
    playerId: player.playerId,
    name: player.name,
    isConnected: player.isConnected,
    isHost: player.isHost,
    isObserver: player.isObserver,
    score: player.score,
    lastActivityAt: player.lastActivityAt,
    connectionStatus: player.isConnected ? "connected" : "offline",
  };
}
```

### 批量同步玩家列表

```typescript
function syncPlayerList(room: Room) {
  const playerList = Array.from(room.players.values()).map((p) => ({
    playerId: p.playerId,
    name: p.name,
    gender: p.gender,
    isHost: p.isHost,
    isObserver: p.isObserver,
    score: p.score,
    isConnected: p.isConnected,
    joinedAt: p.joinedAt,
  }));

  broadcastToRoom(room.roomId, {
    type: "sync:players",
    players: playerList,
    timestamp: Date.now(),
  });
}
```

---

## 📋 玩家資料驗證

### 加入時驗證規則

```typescript
function validatePlayerInfo(info: {
  name: string;
  gender: string;
  birthday: string;
}): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];

  // 姓名驗證
  if (!info.name || info.name.length < 2 || info.name.length > 10) {
    errors.push("姓名長度需為 2-10 個中文字元");
  }

  // 性別驗證
  if (!["male", "female"].includes(info.gender)) {
    errors.push("請選擇有效的性別");
  }

  // 生日驗證
  const birthdayRegex = /^\d{4}\/\d{2}\/\d{2}$/;
  if (!birthdayRegex.test(info.birthday)) {
    errors.push("出生日期格式應為 YYYY/MM/DD");
  } else {
    const date = new Date(info.birthday);
    if (isNaN(date.getTime())) {
      errors.push("出生日期無效");
    } else if (date > new Date()) {
      errors.push("出生日期不能是未來日期");
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}
```

---

## 🧹 玩家清理策略

### 自動清理規則

```typescript
function cleanupOfflinePlayers(room: Room) {
  const now = Date.now();
  const offlineThreshold = 5 * 60 * 1000; // 5 分鐘

  room.players.forEach((player, playerId) => {
    if (!player.isConnected) {
      const offlineDuration = now - player.lastHeartbeat;

      if (offlineDuration > offlineThreshold) {
        // 永久離線，清理玩家記錄
        room.players.delete(playerId);

        logger.info(
          `玩家 ${player.name} (${playerId}) ` +
            `已清理，離線時間 ${(offlineDuration / 60000).toFixed(1)} 分鐘`,
        );
      }
    }
  });
}
```

---

## 📊 玩家相關統計

### 房間玩家統計

```typescript
function getRoomStats(roomId: string) {
  const room = gameState.rooms.get(roomId);
  if (!room) return null;

  const onlinePlayers = Array.from(room.players.values()).filter(
    (p) => p.isConnected,
  );

  const offlinePlayers = Array.from(room.players.values()).filter(
    (p) => !p.isConnected,
  );

  return {
    totalPlayers: room.players.size,
    onlineCount: onlinePlayers.length,
    offlineCount: offlinePlayers.length,
    observerCount: room.observers.size,
    hostId: room.hostId,
    averageScore:
      onlinePlayers.length > 0
        ? onlinePlayers.reduce((sum, p) => sum + p.score, 0) /
          onlinePlayers.length
        : 0,
  };
}
```

---

**文件版本**：1.0  
**最後更新**：2026-02-26
