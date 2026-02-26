# 旁觀者系統技術實現

本文檔涵蓋旁觀者資料結構、兩條加入路徑、答題歷史維護、即時同步等技術細節。

---

## 👀 旁觀者資料結構

```typescript
interface Spectator {
  spectatorId: string; // 旁觀者唯一 ID
  socketId: string; // WebSocket socket ID

  // 身份信息
  name: string; // 旁觀者名稱（可匿名）
  joinedAt: number; // 加入時間戳
  joinMethod: "direct" | "via_member"; // 進入方式

  // 連線狀態
  isConnected: boolean;
  lastHeartbeat: number;
  connectionAttempts: number;

  // 視圖狀態
  viewType: "dashboard" | "chat"; // 旁觀者看板或聊天視圖
}

interface AnswerRecord {
  answerId: string; // 答題記錄 ID
  questionId: string; // 對應的問題 ID
  playerId: string; // 回答者 ID
  playerName: string; // 回答者名稱

  // 答題內容
  question: string; // 問題文本
  answer: string | null; // 給定的答案

  // 狀態
  status: "confirmed" | "skipped"; // 確認或跳過

  // 元數據
  answeredAt: number; // 答題時間戳
  index: number; // 在歷史中的序號（用於循環清除）
}
```

---

## 🚪 旁觀者加入路徑

### 路徑 1：透過成員加入流程（自動轉為旁觀者）

**流程**：

```
遊戲進行中
  ↓ 玩家掃描分享連結或輸入房間代碼點擊加入
  ↓
member:join 事件
  ↓
伺服器檢查房間狀態
  ├─ 若房間未鎖定 → 正常玩家加入
  └─ 若房間已鎖定 → 轉為旁觀者
  ↓
spectator:joined 事件廣播
  ↓
推送完整旁觀者看板數據
```

**代碼實現**：

```typescript
if (data.type === "member:join") {
  const { roomId, name, gender, birthday } = data;
  const room = gameState.rooms.get(roomId);

  if (!room) {
    peer.send(
      JSON.stringify({
        type: "error",
        message: "房間不存在",
      }),
    );
    return;
  }

  // 檢查房間是否鎖定
  if (room.isLocked) {
    // 房間已進行中，自動轉為旁觀者
    const spectatorId = crypto.randomUUID();

    const spectator: Spectator = {
      spectatorId,
      socketId: peer.id,
      name: name || "訪客",
      joinedAt: Date.now(),
      joinMethod: "via_member",
      isConnected: true,
      lastHeartbeat: Date.now(),
      connectionAttempts: 0,
      viewType: "dashboard",
    };

    room.observers.set(spectatorId, spectator);
    (peer as any).spectatorId = spectatorId;
    (peer as any).roomId = roomId;

    // 廣播旁觀者加入
    broadcastToRoom(roomId, {
      type: "spectator:joined",
      spectatorId,
      name: spectator.name,
      joinMethod: "via_member",
    });

    // 推送完整旁觀者看板
    const spectatorData = buildSpectatorSync(room);
    peer.send(
      JSON.stringify({
        type: "spectator:sync",
        ...spectatorData,
      }),
    );

    return;
  }

  // 房間未鎖定，正常玩家加入流程
  // ... 略
}
```

### 路徑 2：直接進入旁觀者看板（無需填資訊）

**流程**：

```
玩家在首頁直接選擇「進入旁觀者看板」
  ↓
spectator:watch 事件
  ↓
伺服器無需驗證玩家資訊
  ↓
建立旁觀者身份
  ↓
推送完整看板數據
```

**代碼實現**：

```typescript
if (data.type === "spectator:watch") {
  const { roomId, visitorName } = data;
  const room = gameState.rooms.get(roomId);

  if (!room) {
    peer.send(
      JSON.stringify({
        type: "error",
        code: "ROOM_NOT_FOUND",
        message: "房間不存在",
      }),
    );
    return;
  }

  // 建立旁觀者身份（不填任何遊戲資訊）
  const spectatorId = crypto.randomUUID();

  const spectator: Spectator = {
    spectatorId,
    socketId: peer.id,
    name: visitorName || `訪客_${Date.now()}`,
    joinedAt: Date.now(),
    joinMethod: "direct",
    isConnected: true,
    lastHeartbeat: Date.now(),
    connectionAttempts: 0,
    viewType: "dashboard",
  };

  room.observers.set(spectatorId, spectator);
  (peer as any).spectatorId = spectatorId;
  (peer as any).roomId = roomId;

  // 廣播旁觀者加入
  broadcastToRoom(roomId, {
    type: "spectator:joined",
    spectatorId,
    name: spectator.name,
    joinMethod: "direct",
  });

  // 推送完整旁觀者看板
  const spectatorData = buildSpectatorSync(room);
  peer.send(
    JSON.stringify({
      type: "spectator:sync",
      ...spectatorData,
    }),
  );
}
```

---

## 📊 旁觀者看板資料構造

### 完整同步資料

```typescript
function buildSpectatorSync(room: Room) {
  // 1. 玩家列表
  const players = Array.from(room.players.values()).map((p) => ({
    playerId: p.playerId,
    name: p.name,
    status: p.isConnected ? "connected" : "offline",
    score: p.score,
    gender: p.gender,
    contributions: p.contributions,
  }));

  // 2. 答題歷史（最多 50 筆）
  const answerHistory = room.answerHistory || [];
  const displayHistory = answerHistory.slice(-50).map((record) => ({
    answerId: record.answerId,
    playerId: record.playerId,
    playerName: record.playerName,
    question: record.question,
    answer: record.answer,
    status: record.status,
    timestamp: record.answeredAt,
  }));

  // 3. 骨架族譜（MVFT）
  const mvftNodes = Array.from(room.familyTree.nodes.values()).map((node) => ({
    id: node.id,
    name: node.name,
    gender: node.gender,
    isPlayer: node.isPlayer,
    isVirtual: node.isVirtual,
    relationships: {
      father: node.father,
      mother: node.mother,
      spouse: node.spouse,
      children: node.children,
    },
  }));

  // 4. 族譜完成度
  const totalNodes = room.familyTree.nodes.size;
  const completedNodes = Array.from(room.familyTree.nodes.values()).filter(
    (n) => n.name !== null,
  ).length;
  const completeness =
    totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0;

  return {
    players,
    answerHistory: displayHistory,
    mvft: {
      nodes: mvftNodes,
      completeness,
    },
    roomStatus: room.status,
    remainingTime: room.gameStartTime
      ? Math.max(
          0,
          room.gameDuration - (Date.now() - room.gameStartTime) / 1000,
        )
      : room.gameDuration,
    timestamp: Date.now(),
  };
}
```

---

## 💬 答題歷史管理

### 答題記錄建立

```typescript
if (data.type === "relationship_confirmed") {
  const { questionId, answer } = data;
  const gamePeer = peer as GamePeer;
  const room = gameState.rooms.get(gamePeer.roomId);

  if (!room) return;

  const player = room.players.get(gamePeer.playerId);
  if (!player) return;

  // 建立答題記錄
  const answerRecord: AnswerRecord = {
    answerId: crypto.randomUUID(),
    questionId,
    playerId: player.playerId,
    playerName: player.name,
    question: getQuestionText(questionId), // 從快取取得問題文本
    answer,
    status: "confirmed",
    answeredAt: Date.now(),
    index: room.answerHistory ? room.answerHistory.length : 0,
  };

  // 初始化歷史陣列
  if (!room.answerHistory) {
    room.answerHistory = [];
  }

  // 加入歷史
  room.answerHistory.push(answerRecord);

  // 循環清除：保持最多 50 筆
  if (room.answerHistory.length > 50) {
    room.answerHistory.shift(); // 移除最舊的記錄
  }

  // 廣播給所有旁觀者
  broadcastToSpectators(room.roomId, {
    type: "spectator:answer_submitted",
    answerId: answerRecord.answerId,
    playerId: player.playerId,
    playerName: player.name,
    question: answerRecord.question,
    answer,
    timestamp: answerRecord.answeredAt,
  });
}
```

### 歷史循環清除策略

```typescript
function manageAnswerHistory(room: Room) {
  if (!room.answerHistory) return;

  // 檢查記錄數量
  if (room.answerHistory.length > 50) {
    // 移除最舊的一條記錄
    const removed = room.answerHistory.shift();

    console.log(
      `[歷史清除] 房間 ${room.roomId}: ` +
        `移除第 ${removed?.index} 條記錄 ` +
        `(時間: ${new Date(removed?.answeredAt || 0).toISOString()})`,
    );
  }

  // 重新計算索引
  room.answerHistory.forEach((record, idx) => {
    record.index = idx;
  });
}
```

---

## 🔄 實時同步機制

### 推送旁觀者更新

```typescript
function broadcastToSpectators(roomId: string, message: any) {
  const room = gameState.rooms.get(roomId);
  if (!room || !room.observers) return;

  const messageStr = JSON.stringify(message);

  // 發送給所有旁觀者
  room.observers.forEach((spectator) => {
    const peerConnection = connections.get(spectator.socketId);

    if (peerConnection && spectator.isConnected) {
      peerConnection.send(messageStr);
    }
  });
}
```

### 玩家狀態推送

```typescript
if (data.type === "heartbeat") {
  const gamePeer = peer as GamePeer;
  const room = gameState.rooms.get(gamePeer.roomId);

  if (room && room.observers.size > 0) {
    const player = room.players.get(gamePeer.playerId);

    if (player) {
      // 推送玩家最新狀態給旁觀者
      broadcastToSpectators(gamePeer.roomId, {
        type: "spectator:player_status",
        playerId: player.playerId,
        name: player.name,
        status: "connected",
        score: player.score,
        timestamp: Date.now(),
      });
    }
  }
}
```

### 族譜更新推送

```typescript
function notifySpectatorOfTreeUpdate(
  room: Room,
  nodeId: string,
  action: "created" | "updated" | "merged",
) {
  if (!room.observers || room.observers.size === 0) return;

  const node = room.familyTree.nodes.get(nodeId);
  if (!node) return;

  const totalNodes = room.familyTree.nodes.size;
  const completedNodes = Array.from(room.familyTree.nodes.values()).filter(
    (n) => n.name !== null,
  ).length;
  const completeness =
    totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0;

  broadcastToSpectators(room.roomId, {
    type: "spectator:tree_updated",
    nodeId,
    action,
    nodeName: node.name,
    nodeInfo: {
      name: node.name,
      gender: node.gender,
      birthday: node.birthday,
    },
    completeness,
    timestamp: Date.now(),
  });
}
```

### 定期完整同步

```typescript
const SPECTATOR_SYNC_INTERVAL = 5 * 1000; // 5 秒同步一次

setInterval(() => {
  gameState.rooms.forEach((room) => {
    if (!room.observers || room.observers.size === 0) return;

    // 構建完整旁觀者同步資料
    const spectatorData = buildSpectatorSync(room);

    // 發送給所有旁觀者
    room.observers.forEach((spectator) => {
      const peerConnection = connections.get(spectator.socketId);

      if (peerConnection && spectator.isConnected) {
        peerConnection.send(
          JSON.stringify({
            type: "spectator:sync",
            ...spectatorData,
          }),
        );
      }
    });
  });
}, SPECTATOR_SYNC_INTERVAL);
```

---

## 📡 旁觀者 WebSocket 事件完整清單

| 事件                         | 方向               | 說明             |
| ---------------------------- | ------------------ | ---------------- |
| `spectator:watch`            | Client → Server    | 直接進入旁觀看板 |
| `spectator:joined`           | Server → All       | 廣播旁觀者加入   |
| `spectator:sync`             | Server → Spectator | 完整看板數據同步 |
| `spectator:answer_submitted` | Server → Spectator | 實時答題更新     |
| `spectator:player_status`    | Server → Spectator | 玩家狀態變更     |
| `spectator:tree_updated`     | Server → Spectator | 族譜節點變更     |
| `spectator:redirect`         | Server → Client    | 重導向至旁觀模式 |

---

## 🔌 旁觀者斷線重連

```typescript
// 旁觀者重連
if (data.type === "spectator:watch") {
  const { roomId, spectatorId } = data; // 若重連，提供舊 ID
  const room = gameState.rooms.get(roomId);

  if (!room) {
    peer.send(
      JSON.stringify({
        type: "error",
        code: "ROOM_NOT_FOUND",
      }),
    );
    return;
  }

  let spectator: Spectator;

  // 檢查是否為舊旁觀者重連
  if (spectatorId && room.observers.has(spectatorId)) {
    spectator = room.observers.get(spectatorId)!;
    spectator.socketId = peer.id;
    spectator.isConnected = true;
    spectator.lastHeartbeat = Date.now();
  } else {
    // 新旁觀者
    spectator = {
      spectatorId: crypto.randomUUID(),
      socketId: peer.id,
      name: `訪客_${Date.now()}`,
      joinedAt: Date.now(),
      joinMethod: "direct",
      isConnected: true,
      lastHeartbeat: Date.now(),
      connectionAttempts: 0,
      viewType: "dashboard",
    };

    room.observers.set(spectator.spectatorId, spectator);
  }

  (peer as any).spectatorId = spectator.spectatorId;
  (peer as any).roomId = roomId;

  // 推送完整看板
  const spectatorData = buildSpectatorSync(room);
  peer.send(
    JSON.stringify({
      type: "spectator:sync",
      ...spectatorData,
    }),
  );
}
```

---

**文件版本**：1.0  
**最後更新**：2026-02-26
