# 房間管理與連線機制規格書

## Connection & Room Management Specification

---

## 📋 文件概述

本文件專門規範「家族族譜連連看」遊戲系統中的**房間管理**與**玩家連線機制**，與族譜邏輯解耦，確保遊戲進行順利的基礎設施。

---

## 🔧 技術架構 (Technical Stack)

- **後端協議**：Nitro Native WebSocket (`defineWebSocketHandler`)
- **通訊模式**：全雙工即時通訊
- **狀態同步**：所有狀態變更（玩家加入、開始輸入、房主變更）透過 Server 主動推送至所有連線 Client
- **資料儲存**：伺服器端記憶體 (in-memory)
- **斷線處理**：localStorage + playerId 機制 + 自動重連

### Nuxt 配置

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  nitro: {
    experimental: {
      websocket: true,
    },
  },
});
```

---

## 🎯 房間狀態機 (Room State Machine)

| 狀態                  | 觸發條件              | UI 呈現與權限                            |
| --------------------- | --------------------- | ---------------------------------------- |
| **未啟動** (Idle)     | 系統初始 / 無活躍房間 | 顯示「建立房間」表單，輸入名稱與秒數     |
| **等待中** (Waiting)  | 房主完成建立          | 允許新連線加入，進入「基本資料輸入」流程 |
| **進行中** (In-Game)  | 房主按下開始          | 鎖定房間，新進者自動轉為「旁觀者模式」   |
| **結算中** (Finished) | 遊戲時間結束          | 顯示最終族譜長相，停止所有遊戲操作       |

### 狀態轉換圖

```
Idle ──[建立房間]──> Waiting ──[開始遊戲]──> In-Game ──[時間到]──> Finished
                        ↑                                              │
                        └───────────────[重新開始]──────────────────────┘
```

---

## 👥 玩家流程與資料規範

### 3.1 房主建立規則

**房主身份**：第一位訪問系統的玩家自動成為房主

**建立流程**：

1. 輸入**遊戲名稱**（房間名稱）
2. 選擇**遊戲時間**（預設選項：180s, 300s, 自訂）
3. 系統產生唯一的 **roomId**
4. 生成**分享連結**：`https://domain.com/room/{roomId}`

**權限**：

- 可設定房間參數
- 擁有「開始遊戲」按鈕
- 離線時權限自動移交（見 4.1）

### 3.2 加入者流程 (Joining Flow)

**所有連入房間的玩家（包括房主）必須完成基本資料設定**：

#### 必填項目

- **姓名**：真實中文姓名
- **性別**：Male / Female
- **完整出生年月日**：YYYY/MM/DD 格式

> **重要**：此處輸入的生日為系統定位與排序的核心依據，與遊戲進行中詢問他人的「生日挑戰」屬於不同維度。

#### 資料驗證規則

```typescript
interface PlayerBasicInfo {
  name: string; // 必填，2-10 字元
  gender: Gender; // 必填，Male 或 Female
  birthday: Date; // 必填，YYYY/MM/DD 格式，需為有效日期
}

// 驗證範例
function validatePlayerInfo(info: PlayerBasicInfo): {
  valid: boolean;
  error?: string;
} {
  if (!info.name || info.name.length < 2 || info.name.length > 10) {
    return { valid: false, error: "姓名長度需為 2-10 字元" };
  }

  if (!info.gender || !["male", "female"].includes(info.gender)) {
    return { valid: false, error: "請選擇性別" };
  }

  if (!info.birthday || isNaN(info.birthday.getTime())) {
    return { valid: false, error: "請輸入有效的出生日期" };
  }

  return { valid: true };
}
```

### 3.3 等待大廳 (Lobby) 狀態顯示

在等待遊戲開始的畫面中，系統需**即時同步**以下狀態：

#### 玩家狀態類型

| 狀態                | 顯示內容                   | 圖示建議    |
| ------------------- | -------------------------- | ----------- |
| **輸入中** (Typing) | 「某位家人輸入資訊中...」  | ⌛ 沙漏動畫 |
| **已就緒** (Ready)  | 顯示「真實姓名」與「性別」 | ✅ 綠色勾勾 |
| **房主** (Owner)    | 姓名 + 「👑 房主」標籤     | 👑 皇冠圖示 |

#### Lobby UI 範例

```vue
<template>
  <div class="lobby">
    <h2>{{ roomInfo.roomName }}</h2>
    <p>遊戲時間：{{ roomInfo.gameTime }}s</p>

    <div class="players-list">
      <div v-for="player in players" :key="player.playerId" class="player-item">
        <span v-if="player.status === 'typing'" class="typing">
          ⌛ 某位家人輸入資訊中...
        </span>
        <span v-else class="ready">
          ✅ {{ player.name }}
          <span class="gender">{{
            player.gender === "male" ? "👨" : "👩"
          }}</span>
          <span v-if="player.isOwner" class="owner-badge">👑 房主</span>
        </span>
      </div>
    </div>

    <button
      v-if="isOwner && allPlayersReady"
      @click="startGame"
      class="start-button"
    >
      開始遊戲
    </button>
  </div>
</template>
```

---

## 🔌 特殊連線邏輯處理

### 4.1 房主離線機制 (Owner Disconnection)

#### 遊戲開始前

**觸發條件**：房主 WebSocket 斷線且超過緩衝時間（30秒）

**處理流程**：

1. Server 偵測房主離線
2. 系統將房主權限自動移交給**房間內連線時間最久的玩家**
3. 廣播 `owner_changed` 事件給所有玩家
4. 新房主的 UI 顯示「開始遊戲」按鈕

**實作範例**：

```typescript
// server/utils/roomManager.ts
export function handleOwnerDisconnection(room: Room, ownerId: string) {
  if (room.status !== "waiting") return;

  // 找出連線時間最久的玩家
  const candidates = Array.from(room.players.values())
    .filter((p) => !p.isOffline && p.playerId !== ownerId)
    .sort((a, b) => a.joinedAt - b.joinedAt);

  if (candidates.length === 0) {
    // 房間無人，刪除房間
    gameState.rooms.delete(room.roomId);
    return;
  }

  // 移交權限
  const newOwner = candidates[0];
  room.controllerId = newOwner.socketId;

  // 廣播權限變更
  broadcastToRoom(room.roomId, {
    type: "owner_changed",
    newOwnerId: newOwner.playerId,
    newOwnerName: newOwner.name,
  });
}
```

#### 遊戲進行中

**觸發條件**：房主在遊戲進行中離線

**處理原則**：

- ❌ **遊戲不會中止**
- ✅ 其他玩家繼續進行搶答
- ✅ 伺服器計時器繼續倒數
- ✅ 房主可重連恢復遊戲狀態

**重連機制**：

```typescript
// 房主重連後恢復權限
if (data.type === "reconnect" && playerId === room.originalOwnerId) {
  room.controllerId = peer.id;
  peer.send(
    JSON.stringify({
      type: "owner_restored",
      roomState: getCurrentRoomState(room),
    }),
  );
}
```

### 4.2 旁觀者機制 (Spectator Mode)

#### 觸發條件

房間狀態為 `In-Game` 時才連入的玩家自動轉為旁觀者

#### 行為限制

- ❌ **不可參與**關係定義
- ❌ **不可參與**資料搶答
- ❌ **不計入**最終排名
- ✅ **可觀看**即時進度面板

#### 旁觀者 UI

```vue
<template>
  <div class="spectator-view">
    <div class="spectator-badge">👀 旁觀者模式</div>

    <p class="info">遊戲進行中，您以旁觀者身份加入</p>

    <!-- 即時進度面板 -->
    <div class="progress-panel">
      <h3>遊戲進度</h3>
      <div class="progress-bar">
        <div class="fill" :style="{ width: completeness + '%' }"></div>
      </div>
      <p>已完成節點：{{ completedNodes }} / {{ totalNodes }}</p>

      <div class="leaderboard">
        <h4>即時排名</h4>
        <ul>
          <li v-for="(player, index) in ranking" :key="player.playerId">
            {{ index + 1 }}. {{ player.name }} - {{ player.score }} 分
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
```

#### 資料結構

```typescript
interface Player {
  playerId: string;
  socketId: string;
  nodeId: string;
  name: string;
  gender: Gender;
  birthday: Date;
  score: number;
  isOffline: boolean;
  isObserver: boolean; // 旁觀者標記
  joinedAt: number;
}
```

---

## 📡 WebSocket 事件定義 (Nitro Handler)

### 基礎連線事件

| 事件名稱               | 方向            | 資料結構                                        | 說明                         |
| ---------------------- | --------------- | ----------------------------------------------- | ---------------------------- |
| `room:create`          | Client → Server | `{ name, gameTime }`                            | 建立房間並初始化設定         |
| `room:created`         | Server → Client | `{ roomId, shareLink }`                         | 回傳房間資訊                 |
| `member:typing`        | Client → Server | `{ roomId }`                                    | 通知其他玩家有新成員正在輸入 |
| `member:typing_notify` | Server → All    | `{ timestamp }`                                 | 廣播有人正在輸入             |
| `member:join`          | Client → Server | `{ roomId, playerId?, name, gender, birthday }` | 提交資料後正式加入           |
| `member:joined`        | Server → All    | `{ playerId, name, gender, isOwner }`           | 廣播新成員加入               |
| `game:start`           | Client → Server | `{ roomId }`                                    | 房主觸發遊戲開始             |
| `game:started`         | Server → All    | `{ startTime, phase }`                          | 廣播遊戲已開始，房間鎖定     |
| `sync:state`           | Server → All    | `{ players[], status, remainingTime }`          | 推送最新房間狀態             |

### 權限管理事件

| 事件名稱         | 方向            | 資料結構                       | 說明             |
| ---------------- | --------------- | ------------------------------ | ---------------- |
| `owner_changed`  | Server → All    | `{ newOwnerId, newOwnerName }` | 房主權限移交通知 |
| `owner_restored` | Server → Client | `{ roomState }`                | 房主重連恢復權限 |

### 旁觀者事件

| 事件名稱           | 方向               | 資料結構                | 說明                 |
| ------------------ | ------------------ | ----------------------- | -------------------- |
| `spectator:join`   | Client → Server    | `{ roomId, name }`      | 旁觀者加入           |
| `spectator:joined` | Server → All       | `{ spectatorId, name }` | 廣播旁觀者加入       |
| `spectator:sync`   | Server → Spectator | `{ progress, ranking }` | 推送即時進度給旁觀者 |

---

## 💻 伺服器端實作

### WebSocket 連線處理器

```typescript
// server/routes/ws.ts
import type { Peer } from "crossws";
import { gameState } from "../utils/gameState";
import { handleOwnerDisconnection } from "../utils/roomManager";

interface GamePeer extends Peer {
  playerId?: string;
  roomId?: string;
  playerName?: string;
  isOwner?: boolean;
}

const connections = new Map<string, GamePeer>();

export default defineWebSocketHandler({
  open(peer) {
    console.log(`[WS] 連線: ${peer.id}`);
    connections.set(peer.id, peer as GamePeer);
  },

  message(peer, message) {
    try {
      const data = JSON.parse(message.text());
      const gamePeer = peer as GamePeer;

      // 建立房間
      if (data.type === "room:create") {
        const roomId = crypto.randomUUID().substring(0, 8).toUpperCase();
        const room: Room = {
          roomId,
          roomName: data.name,
          status: "waiting",
          gameTime: data.gameTime,
          players: new Map(),
          familyTree: { nodes: new Map(), rootNodes: [] },
          taskQueue: [],
          completedTasks: [],
          controllerId: peer.id,
          isLocked: false,
          createdAt: Date.now(),
        };

        gameState.rooms.set(roomId, room);
        gamePeer.roomId = roomId;
        gamePeer.isOwner = true;

        peer.send(
          JSON.stringify({
            type: "room:created",
            roomId,
            shareLink: `${process.env.BASE_URL}/room/${roomId}`,
          }),
        );
      }

      // 成員正在輸入
      if (data.type === "member:typing") {
        const room = gameState.rooms.get(data.roomId);
        if (room) {
          broadcastToRoom(data.roomId, {
            type: "member:typing_notify",
            timestamp: Date.now(),
          });
        }
      }

      // 成員加入
      if (data.type === "member:join") {
        const { roomId, playerId, name, gender, birthday } = data;
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

        // 檢查房間是否鎖定（遊戲進行中）
        if (room.isLocked) {
          // 設為旁觀者
          const spectatorId = crypto.randomUUID();
          gamePeer.playerId = spectatorId;
          gamePeer.roomId = roomId;
          gamePeer.playerName = name;

          peer.send(
            JSON.stringify({
              type: "spectator:join",
              spectatorId,
              message: "遊戲進行中，您以旁觀者身份加入",
            }),
          );

          broadcastToRoom(roomId, {
            type: "spectator:joined",
            spectatorId,
            name,
          });
          return;
        }

        // 正常加入
        let player: Player;

        if (playerId && room.players.has(playerId)) {
          // 重連玩家
          player = room.players.get(playerId)!;
          player.socketId = peer.id;
          player.isOffline = false;
        } else {
          // 新玩家
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
            isOffline: false,
            isObserver: false,
            joinedAt: Date.now(),
          };

          room.players.set(newPlayerId, player);

          // 創建對應的族譜節點
          const node: FamilyNode = {
            id: nodeId,
            isPlayer: true,
            info: { name, gender, birthday: new Date(birthday) },
            relations: { children: [] },
            createdAt: Date.now(),
          };

          room.familyTree.nodes.set(nodeId, node);

          peer.send(
            JSON.stringify({
              type: "player_registered",
              playerId: newPlayerId,
              nodeId,
            }),
          );
        }

        gamePeer.playerId = player.playerId;
        gamePeer.roomId = roomId;
        gamePeer.playerName = name;
        gamePeer.isOwner = room.controllerId === peer.id;

        // 廣播成員加入
        broadcastToRoom(roomId, {
          type: "member:joined",
          playerId: player.playerId,
          name: player.name,
          gender: player.gender,
          isOwner: gamePeer.isOwner,
        });

        // 同步房間狀態
        syncRoomState(room);
      }

      // 開始遊戲
      if (data.type === "game:start") {
        const room = gameState.rooms.get(data.roomId);
        if (!room || room.controllerId !== peer.id) {
          peer.send(
            JSON.stringify({
              type: "error",
              message: "只有房主可以開始遊戲",
            }),
          );
          return;
        }

        room.status = "relationship-scan";
        room.isLocked = true;
        room.startTime = Date.now();

        broadcastToRoom(data.roomId, {
          type: "game:started",
          startTime: room.startTime,
          phase: room.status,
        });
      }
    } catch (error) {
      console.error("[WS] 訊息處理錯誤:", error);
    }
  },

  close(peer) {
    console.log(`[WS] 斷線: ${peer.id}`);
    const gamePeer = peer as GamePeer;

    if (gamePeer.roomId && gamePeer.playerId) {
      const room = gameState.rooms.get(gamePeer.roomId);
      if (room) {
        const player = room.players.get(gamePeer.playerId);
        if (player) {
          player.isOffline = true;

          // 如果是房主離線
          if (gamePeer.isOwner) {
            handleOwnerDisconnection(room, gamePeer.playerId);
          }

          // 通知其他玩家
          broadcastToRoom(gamePeer.roomId, {
            type: "player_offline",
            playerId: player.playerId,
            name: player.name,
          });

          syncRoomState(room);
        }
      }
    }

    connections.delete(peer.id);
  },

  error(peer, error) {
    console.error("[WS] 錯誤:", error);
  },
});

// 輔助函數：廣播訊息給房間
function broadcastToRoom(roomId: string, message: any) {
  const room = gameState.rooms.get(roomId);
  if (!room) return;

  const messageStr = JSON.stringify(message);

  room.players.forEach((player) => {
    const peerConnection = connections.get(player.socketId);
    if (peerConnection && !player.isOffline) {
      peerConnection.send(messageStr);
    }
  });
}

// 同步房間狀態
function syncRoomState(room: Room) {
  const players = Array.from(room.players.values()).map((p) => ({
    playerId: p.playerId,
    name: p.name,
    gender: p.gender,
    score: p.score,
    isOffline: p.isOffline,
    isObserver: p.isObserver,
  }));

  const remainingTime = room.startTime
    ? Math.max(
        0,
        room.gameTime - Math.floor((Date.now() - room.startTime) / 1000),
      )
    : room.gameTime;

  broadcastToRoom(room.roomId, {
    type: "sync:state",
    players,
    status: room.status,
    remainingTime,
    isLocked: room.isLocked,
  });
}
```

---

## 🔄 斷線重連機制

### 實作流程

1. **初次連線**：Server 產生 `playerId` 與 `nodeId`，回傳給 Client 儲存至 `localStorage`
2. **斷線**：WebSocket 斷線時，Server 將玩家標記為 `isOffline: true`，但保留資料
3. **重連**：Client 重新連線時攜帶 `playerId`，Server 比對成功後恢復狀態
4. **清理**：離線超過 5 分鐘的玩家會被自動清除

### localStorage 結構

```typescript
interface StoredPlayerData {
  playerId: string;
  nodeId: string;
  lastRoomId: string;
  name: string;
  gender: Gender;
  birthday: string;
}

// 儲存
localStorage.setItem(
  "familyTreeGame",
  JSON.stringify({
    playerId: "uuid-xxxx",
    nodeId: "uuid-yyyy",
    lastRoomId: "ROOM123",
    name: "王小明",
    gender: "male",
    birthday: "1990/01/15",
  }),
);

// 讀取
const stored = JSON.parse(localStorage.getItem("familyTreeGame") || "{}");
```

### 客戶端自動重連

```typescript
// composables/useSocket.ts
const connectWebSocket = () => {
  const stored = JSON.parse(localStorage.getItem("familyTreeGame") || "{}");

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws.value = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.value.onopen = () => {
    isConnected.value = true;
    console.log("[WebSocket] 已連線");

    // 如果有儲存的 playerId，嘗試重連
    if (stored.playerId && stored.lastRoomId) {
      reconnect(stored);
    }
  };

  ws.value.onclose = () => {
    isConnected.value = false;
    console.log("[WebSocket] 已斷線，3秒後重連...");
    setTimeout(connectWebSocket, 3000); // 自動重連
  };
};

const reconnect = (stored: StoredPlayerData) => {
  send("member:join", {
    roomId: stored.lastRoomId,
    playerId: stored.playerId,
    name: stored.name,
    gender: stored.gender,
    birthday: stored.birthday,
  });
};
```

---

## 🧪 測試檢查清單

### 房間管理測試

- [ ] 建立房間並取得唯一 roomId
- [ ] 生成正確的分享連結
- [ ] 房主標記正確顯示
- [ ] 多個房間可同時運作

### 玩家連線測試

- [ ] 基本資料輸入驗證（姓名、性別、生日）
- [ ] 「輸入中」狀態正確顯示
- [ ] 「已就緒」狀態正確切換
- [ ] 多位玩家同時加入無衝突

### 房主權限測試

- [ ] 只有房主可看到「開始遊戲」按鈕
- [ ] 房主離線後權限自動移交
- [ ] 新房主可正常操作
- [ ] 原房主重連後恢復權限

### 旁觀者機制測試

- [ ] 遊戲開始後加入自動轉為旁觀者
- [ ] 旁觀者無法參與遊戲
- [ ] 旁觀者可查看即時進度
- [ ] 旁觀者列表正確顯示

### 斷線重連測試

- [ ] localStorage 正確儲存玩家資訊
- [ ] 斷線後 3 秒自動重連
- [ ] 重連後恢復原有狀態
- [ ] 離線超過 5 分鐘被清除

### 狀態同步測試

- [ ] 所有玩家看到一致的成員列表
- [ ] 房間狀態變化即時同步
- [ ] 計時器在所有客戶端一致
- [ ] 網路延遲不影響遊戲公平性

---

## 🔍 除錯指南

### WebSocket 連線問題

```bash
# 檢查 WebSocket 連線狀態
# 在瀏覽器 Console 執行
console.log(ws.readyState);
// 0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED
```

### 房間狀態不同步

```typescript
// 強制同步房間狀態
function forceSyncRoom(roomId: string) {
  const room = gameState.rooms.get(roomId);
  if (room) {
    syncRoomState(room);
  }
}
```

### 權限移交失敗

```typescript
// 檢查房間內玩家連線狀態
function debugRoomPlayers(roomId: string) {
  const room = gameState.rooms.get(roomId);
  if (!room) return;

  const playerList = Array.from(room.players.values()).map((p) => ({
    id: p.playerId,
    name: p.name,
    isOffline: p.isOffline,
    joinedAt: new Date(p.joinedAt).toISOString(),
  }));

  console.log("房間玩家狀態:", playerList);
  console.log("當前房主:", room.controllerId);
}
```

---

## 📚 相關文件

- [SYSTEM_INSTRUCTIONS.md](./SYSTEM_INSTRUCTIONS.md) - 完整系統技術規格
- [package.json](./package.json) - 專案依賴配置
- [nuxt.config.ts](./nuxt.config.ts) - Nuxt 配置檔案

---

**文件版本**：v1.0  
**最後更新**：2026-02-16  
**維護者**：Development Team
