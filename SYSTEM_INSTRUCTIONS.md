# 家族樹遊戲系統 - 開發指示文件

## 📋 專案概述

本專案為基於 Nuxt 3 的「**家族族譜連連看 (Family Tree Connect)**」遊戲系統，採用 **Nitro 原生 WebSocket** 實現實時通訊。這是一款專為親戚聚會設計的限時社交遊戲，玩家透過連線進入同一房間，藉由回答彼此關係與填寫祖先資料，在限定時間內集體合作拼湊出一個完整的有序無環圖 (DAG) 族譜。系統支援斷線重連、房間管理、即時計分等功能。

---

## 🎮 遊戲規格 v1.1

### 核心機制

1. **真實關係**：玩家皆為真實親戚，資料具備真實性
2. **兩階段玩法**：先建立「關係骨幹」，再搶答「節點資料」
3. **合力競速**：全體玩家共同完成族譜，但個人依填寫貢獻度計分
4. **資訊隱蔽**：遊戲過程中不顯示族譜全貌，僅在結束時進行「大揭曉」

### 遊戲流程

#### 階段一：準備與加入 (Waiting Room)

- **房主建立**：設定房間名稱、選擇遊戲時間（預設 180s, 300s）
- **玩家進入**：輸入姓名、性別、生日（選填）
- **鎖定房間**：房主按下開始後，新進入者僅能以「旁觀者」身份進入，不可參與

#### 階段二：關係掃描 (Relationship Scan)

- **目標**：建立玩家間的 Edge（連線）
- **形式**：一對一圖卡提問（例如：Tinder 式滑動卡片）
- **邏輯**：系統挑選玩家組合進行提問。只要兩者關係確立，系統自動生成虛擬中間節點

#### 階段三：資料搶答 (Data Sprint)

- **目標**：填補虛擬節點內容
- **形式**：快速任務清單，玩家看不到族譜
- **獨佔提問規則 (Exclusive Quizzing)**：
  - **單一派發**：同一個節點資料任務在同一時間只會派發給一位玩家
  - **任務流轉**：只有當該玩家選擇「不知道」或「跳過」時，系統才會將該問題重新投入題目池
  - **鎖定機制**：一旦有人正在輸入中，該任務從所有人的潛在題目池中暫時移除

#### 階段四：大揭曉 (The Big Reveal)

- **動畫呈現**：從現場玩家節點開始，向外延伸長出整個家族樹
- **結果結算**：顯示家族完整度、MVP（得分最高者）

### 提問演算法與題目流轉

1. **關係鄰近優先**：系統優先將虛擬節點的填充任務派發給在 DAG 中物理距離最近的真實玩家
2. **跳過處理**：玩家點擊「跳過」後，該題目的優先級會降低，待其他題目處理完畢後再輪詢給其他玩家
3. **衝突偵測**：若 A 與 B 對同一關係回答矛盾，立即觸發「衝突確認」任務（此任務為少數會同時推播給衝突雙方的特殊卡片）

---

## 🏗️ 系統架構概覽

```
┌─────────────┐     WebSocket      ┌─────────────┐
│  Controller │ ◄──────────────────► │   Server    │
│  (房主介面)  │                      │(Nitro/WS)   │
└─────────────┘                      └─────────────┘
                                            ▲
                                            │ WebSocket
                                            ▼
                                     ┌─────────────┐
                                     │   Client    │
                                     │  (玩家介面)  │
                                     └─────────────┘
```

---

## 📦 技術棧

- **前端框架**: Nuxt 3 (Vue 3 + TypeScript)
- **後端引擎**: Nitro (Nuxt 內建)
- **實時通訊**: Nitro 原生 WebSocket (defineWebSocketHandler)
- **狀態管理**: 伺服器端記憶體 (in-memory)
- **斷線處理**: localStorage + playerId 機制 + 自動重連

---

## 🎯 開發步驟

### Step 1: 啟用 Nitro WebSocket

在 `nuxt.config.ts` 中啟用 WebSocket 支援：

```typescript
export default defineNuxtConfig({
  nitro: {
    experimental: {
      websocket: true,
    },
  },
});
```

### Step 2: 設定專案結構

```
/familyTreeGame
├── server/
│   ├── routes/
│   │   └── ws.ts                  # WebSocket 路由處理器
│   └── utils/
│       ├── gameState.ts           # 遊戲狀態管理
│       ├── roomManager.ts         # 房間管理邏輯
│       ├── dagValidator.ts        # DAG 驗證與衝突檢測
│       ├── taskAssigner.ts        # 任務分派演算法
│       └── scoreCalculator.ts     # 計分系統
├── composables/
│   └── useSocket.ts               # 客戶端 WebSocket 連線
├── pages/
│   ├── controller.vue             # 房主控制介面
│   ├── player.vue                 # 玩家遊戲介面
│   └── observer.vue               # 旁觀者介面
├── components/
│   ├── GameRoom.vue               # 房間資訊顯示
│   ├── RelationshipCard.vue       # 關係掃描卡片（Tinder 式）
│   ├── TaskCard.vue               # 資料搶答任務卡
│   ├── FamilyTreeVisualization.vue # 族譜視覺化（大揭曉）
│   ├── ConflictResolver.vue       # 衝突解決介面
│   └── Scoreboard.vue             # 計分板與 MVP 顯示
└── types/
    └── game.d.ts                  # TypeScript 型別定義
```

---

## 🔧 核心功能實作指南

### 1. 資料結構定義 (`types/game.d.ts`)

#### 1.1 族譜節點結構 (Family Tree Node)

```typescript
// 性別枚舉
export enum Gender {
  Male = "male",
  Female = "female",
}

// 節點資訊
export interface NodeInfo {
  name: string;
  gender: Gender;
  birthday?: Date; // 選填
}

// 節點關係
export interface NodeRelations {
  father?: string; // 指向父親節點 ID
  mother?: string; // 指向母親節點 ID
  spouse?: string; // 指向配偶節點 ID
  children: string[]; // 子女節點 ID 陣列（有序，依長幼排列）
}

// 族譜節點
export interface FamilyNode {
  id: string; // 唯一識別碼
  isPlayer: boolean; // 是否為房間內的玩家
  info: NodeInfo; // 節點資訊
  relations: NodeRelations; // 關係連結
  filledBy?: string; // 填寫者的 playerId（用於計分）
  createdAt: number; // 建立時間
}

// DAG 族譜圖
export interface FamilyTree {
  nodes: Map<string, FamilyNode>; // 所有節點
  rootNodes: string[]; // 根節點 ID（最高輩分）
}

// 任務/問題
export interface Task {
  id: string;
  type: "relationship" | "node-info" | "conflict-resolution";
  targetNodeId: string; // 目標節點
  question: string; // 問題描述
  assignedTo?: string; // 分派給哪位玩家
  isLocked: boolean; // 是否被鎖定（正在作答中）
  priority: number; // 優先級（0-10，跳過後降低）
  relatedPlayers: string[]; // 相關玩家 ID（用於計算鄰近度）
  conflictWith?: string; // 衝突來源玩家 ID
}
```

#### 1.2 玩家結構

```typescript
export interface Player {
  playerId: string;
  socketId: string;
  nodeId: string; // 對應的族譜節點 ID
  name: string;
  gender: Gender;
  birthday?: Date;
  score: number; // 貢獻度計分
  isOffline: boolean;
  isObserver: boolean; // 是否為旁觀者
  joinedAt: number;
}
```

#### 1.3 房間結構

```typescript
export interface Room {
  roomId: string;
  roomName: string;
  status:
    | "waiting"
    | "relationship-scan"
    | "data-sprint"
    | "reveal"
    | "finished";
  gameTime: number; // 遊戲時間（秒）
  startTime?: number; // 開始時間戳記
  players: Map<string, Player>;
  familyTree: FamilyTree; // 族譜 DAG
  taskQueue: Task[]; // 任務佇列
  completedTasks: Task[]; // 已完成任務
  controllerId: string; // 房主 ID
  isLocked: boolean; // 房間是否鎖定
  createdAt: number;
}

export interface GameState {
  rooms: Map<string, Room>;
}
```

---

### 2. DAG 驗證與衝突檢測 (`server/utils/dagValidator.ts`)

```typescript
import type { FamilyTree, FamilyNode, NodeRelations } from "~/types/game";

/**
 * 檢查 DAG 是否存在環路（無環性驗證）
 */
export function detectCycle(tree: FamilyTree, nodeId: string): boolean {
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function hasCycleUtil(currentId: string): boolean {
    if (recStack.has(currentId)) return true;
    if (visited.has(currentId)) return false;

    visited.add(currentId);
    recStack.add(currentId);

    const node = tree.nodes.get(currentId);
    if (!node) return false;

    // 檢查父母節點
    if (node.relations.father && hasCycleUtil(node.relations.father))
      return true;
    if (node.relations.mother && hasCycleUtil(node.relations.mother))
      return true;

    recStack.delete(currentId);
    return false;
  }

  return hasCycleUtil(nodeId);
}

/**
 * 驗證關係的一致性
 */
export function validateRelationship(
  tree: FamilyTree,
  childId: string,
  parentId: string,
  parentType: "father" | "mother",
): { valid: boolean; error?: string } {
  const child = tree.nodes.get(childId);
  const parent = tree.nodes.get(parentId);

  if (!child || !parent) {
    return { valid: false, error: "節點不存在" };
  }

  // 檢查性別是否匹配
  if (parentType === "father" && parent.info.gender !== Gender.Male) {
    return { valid: false, error: "父親節點必須為男性" };
  }
  if (parentType === "mother" && parent.info.gender !== Gender.Female) {
    return { valid: false, error: "母親節點必須為女性" };
  }

  // 檢查是否會產生環路
  if (detectCycle(tree, childId)) {
    return { valid: false, error: "關係會造成環路" };
  }

  return { valid: true };
}

/**
 * 偵測關係衝突
 */
export function detectConflict(
  tree: FamilyTree,
  nodeId: string,
  newInfo: Partial<NodeInfo> | Partial<NodeRelations>,
): { hasConflict: boolean; conflictType?: string; existingData?: any } {
  const node = tree.nodes.get(nodeId);
  if (!node) return { hasConflict: false };

  // 檢查資訊衝突
  if ("name" in newInfo && node.info.name && node.info.name !== newInfo.name) {
    return {
      hasConflict: true,
      conflictType: "name",
      existingData: node.info.name,
    };
  }

  // 檢查關係衝突
  if (
    "father" in newInfo &&
    node.relations.father &&
    node.relations.father !== newInfo.father
  ) {
    return {
      hasConflict: true,
      conflictType: "father",
      existingData: node.relations.father,
    };
  }

  return { hasConflict: false };
}
```

---

### 3. 任務分派演算法 (`server/utils/taskAssigner.ts`)

```typescript
import type { Room, Task, FamilyNode, Player } from "~/types/game";

/**
 * 計算兩個節點在 DAG 中的距離（BFS）
 */
export function calculateDistance(
  tree: FamilyTree,
  fromNodeId: string,
  toNodeId: string,
): number {
  if (fromNodeId === toNodeId) return 0;

  const queue: Array<{ id: string; distance: number }> = [
    { id: fromNodeId, distance: 0 },
  ];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { id, distance } = queue.shift()!;
    if (id === toNodeId) return distance;

    if (visited.has(id)) continue;
    visited.add(id);

    const node = tree.nodes.get(id);
    if (!node) continue;

    // 加入父母、配偶、子女到佇列
    const neighbors = [
      node.relations.father,
      node.relations.mother,
      node.relations.spouse,
      ...node.relations.children,
    ].filter(Boolean);

    neighbors.forEach((neighborId) => {
      queue.push({ id: neighborId!, distance: distance + 1 });
    });
  }

  return Infinity; // 無法到達
}

/**
 * 為任務尋找最適合的玩家（關係鄰近優先）
 */
export function findBestPlayerForTask(room: Room, task: Task): string | null {
  const availablePlayers = Array.from(room.players.values()).filter(
    (p) => !p.isOffline && !p.isObserver,
  );

  if (availablePlayers.length === 0) return null;

  // 計算每個玩家與目標節點的距離
  const playerDistances = availablePlayers.map((player) => ({
    playerId: player.playerId,
    distance: calculateDistance(
      room.familyTree,
      player.nodeId,
      task.targetNodeId,
    ),
  }));

  // 按距離排序（最近優先）
  playerDistances.sort((a, b) => a.distance - b.distance);

  return playerDistances[0].playerId;
}

/**
 * 分派任務給玩家
 */
export function assignTask(room: Room, task: Task): void {
  const playerId = findBestPlayerForTask(room, task);

  if (playerId) {
    task.assignedTo = playerId;
    task.isLocked = false;
    room.taskQueue.push(task);
  }
}

/**
 * 處理任務跳過（降低優先級並重新分派）
 */
export function handleTaskSkip(
  room: Room,
  taskId: string,
  playerId: string,
): void {
  const taskIndex = room.taskQueue.findIndex(
    (t) => t.id === taskId && t.assignedTo === playerId,
  );

  if (taskIndex !== -1) {
    const task = room.taskQueue[taskIndex];

    // 降低優先級
    task.priority = Math.max(0, task.priority - 2);

    // 移除當前分派
    task.assignedTo = undefined;
    task.isLocked = false;

    // 移到佇列尾端
    room.taskQueue.splice(taskIndex, 1);
    room.taskQueue.push(task);

    // 嘗試分派給其他玩家
    const newPlayerId = findBestPlayerForTask(room, task);
    if (newPlayerId && newPlayerId !== playerId) {
      task.assignedTo = newPlayerId;
    }
  }
}
```

---

### 4. 伺服器端狀態管理 (`server/utils/gameState.ts`)

```typescript
import type { GameState, Room, Player } from "~/types/game";

// 全域遊戲狀態
export const gameState: GameState = {
  rooms: new Map(),
};

// 設定定期清理斷線玩家
const OFFLINE_TIMEOUT = 5 * 60 * 1000; // 5分鐘

export function cleanupOfflinePlayers() {
  const now = Date.now();

  gameState.rooms.forEach((room, roomId) => {
    room.players.forEach((player, playerId) => {
      if (player.isOffline && now - player.joinedAt > OFFLINE_TIMEOUT) {
        room.players.delete(playerId);
        console.log(`[Cleanup] 移除玩家 ${playerId}`);
      }
    });

    // 如果房間沒有玩家，刪除房間
    if (room.players.size === 0) {
      gameState.rooms.delete(roomId);
      console.log(`[Cleanup] 刪除空房間 ${roomId}`);
    }
  });
}

// 每分鐘執行一次清理
setInterval(cleanupOfflinePlayers, 60 * 1000);
```

---

### 3. WebSocket 路由設定 (`server/routes/ws.ts`)

```typescript
import type { Peer } from "crossws";
import { gameState } from "../utils/gameState";

// 擴展 Peer 介面
interface GamePeer extends Peer {
  playerId?: string;
  roomId?: string;
  playerName?: string;
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

      // 【事件1】加入房間
      if (data.type === "join_room") {
        const { roomId, playerId, name, isController } = data;
        let room = gameState.rooms.get(roomId);

        if (!room) {
          room = {
            roomId,
            status: "waiting",
            questions: [],
            currentQuestionIndex: 0,
            players: new Map(),
            controllerId: isController ? peer.id : "",
            createdAt: Date.now(),
          };
          gameState.rooms.set(roomId, room);
        }

        let player;
        if (playerId && room.players.has(playerId)) {
          // 重連玩家
          player = room.players.get(playerId)!;
          player.socketId = peer.id;
          player.isOffline = false;
          console.log(`[Room] 玩家重連: ${name}`);
        } else {
          // 新玩家
          const newPlayerId = crypto.randomUUID();
          player = {
            playerId: newPlayerId,
            socketId: peer.id,
            name,
            score: 0,
            isOffline: false,
            lastAnswer: null,
            joinedAt: Date.now(),
          };
          room.players.set(newPlayerId, player);

          peer.send(
            JSON.stringify({
              type: "player_registered",
              playerId: newPlayerId,
            }),
          );
        }

        gamePeer.playerId = player.playerId;
        gamePeer.roomId = roomId;
        gamePeer.playerName = name;

        broadcastToRoom(roomId, {
          type: "room_info",
          roomId,
          status: room.status,
          players: Array.from(room.players.values()).map((p) => ({
            playerId: p.playerId,
            name: p.name,
            score: p.score,
            isOffline: p.isOffline,
          })),
        });
      }

      // 【事件2】開始遊戲
      if (data.type === "start_game") {
        const { roomId, questions } = data;
        const room = gameState.rooms.get(roomId);
        if (!room || room.controllerId !== peer.id) return;

        room.status = "playing";
        room.questions = questions;
        room.currentQuestionIndex = 0;

        const question = room.questions[0];
        broadcastToRoom(roomId, {
          type: "next_question",
          questionIndex: 0,
          question: {
            id: question.id,
            text: question.text,
            type: question.type,
            options: question.options,
            points: question.points,
          },
        });
      }

      // 【事件3】提交答案
      if (data.type === "submit_answer") {
        const { roomId, playerId, answer } = data;
        const room = gameState.rooms.get(roomId);
        if (!room || room.status !== "playing") return;

        const player = room.players.get(playerId);
        if (!player) return;

        const currentQuestion = room.questions[room.currentQuestionIndex];
        const isCorrect = currentQuestion.answer === answer;

        if (isCorrect) {
          player.score += currentQuestion.points;
        }
        player.lastAnswer = answer;

        peer.send(
          JSON.stringify({
            type: "answer_result",
            isCorrect,
            correctAnswer: currentQuestion.answer,
            score: player.score,
          }),
        );

        const controllerPeer = connections.get(room.controllerId);
        if (controllerPeer) {
          controllerPeer.send(
            JSON.stringify({
              type: "player_answered",
              playerId: player.playerId,
              name: player.name,
              isCorrect,
            }),
          );
        }
      }

      // 【事件4】下一題
      if (data.type === "next_question") {
        const { roomId } = data;
        const room = gameState.rooms.get(roomId);
        if (!room || room.controllerId !== peer.id) return;

        room.currentQuestionIndex++;

        if (room.currentQuestionIndex >= room.questions.length) {
          room.status = "finished";
          const ranking = Array.from(room.players.values()).sort(
            (a, b) => b.score - a.score,
          );

          broadcastToRoom(roomId, {
            type: "game_over",
            ranking: ranking.map((p) => ({
              playerId: p.playerId,
              name: p.name,
              score: p.score,
            })),
          });
        } else {
          const question = room.questions[room.currentQuestionIndex];
          broadcastToRoom(roomId, {
            type: "next_question",
            questionIndex: room.currentQuestionIndex,
            question: {
              id: question.id,
              text: question.text,
              type: question.type,
              options: question.options,
              points: question.points,
            },
          });
        }
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
          broadcastToRoom(gamePeer.roomId, {
            type: "player_offline",
            playerId: player.playerId,
            name: player.name,
          });
        }
      }
    }

    connections.delete(peer.id);
  },

  error(peer, error) {
    console.error("[WS] 錯誤:", error);
  },
});

// 輔助函數：廣播訊息給特定房間
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
```

---

### 4. 客戶端 WebSocket 連線 (`composables/useSocket.ts`)

```typescript
import { ref, onMounted, onUnmounted } from "vue";

export function useSocket() {
  const ws = ref<WebSocket | null>(null);
  const isConnected = ref(false);
  const playerId = ref<string | null>(null);
  const messageHandlers = new Map<string, (data: any) => void>();

  const connectWebSocket = () => {
    playerId.value = localStorage.getItem("playerId");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    ws.value = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.value.onopen = () => {
      isConnected.value = true;
      console.log("[WebSocket] 已連線");
    };

    ws.value.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "player_registered") {
          playerId.value = data.playerId;
          localStorage.setItem("playerId", data.playerId);
          console.log("[WebSocket] 玩家 ID 已註冊:", data.playerId);
        }

        const handler = messageHandlers.get(data.type);
        if (handler) {
          handler(data);
        }
      } catch (error) {
        console.error("[WebSocket] 訊息解析錯誤:", error);
      }
    };

    ws.value.onclose = () => {
      isConnected.value = false;
      console.log("[WebSocket] 已斷線，3秒後重連...");
      setTimeout(connectWebSocket, 3000);
    };

    ws.value.onerror = (error) => {
      console.error("[WebSocket] 錯誤:", error);
    };
  };

  onMounted(() => {
    connectWebSocket();
  });

  onUnmounted(() => {
    ws.value?.close();
  });

  const send = (type: string, data: any = {}) => {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify({ type, ...data }));
    } else {
      console.warn("[WebSocket] 連線未就緒");
    }
  };

  const on = (eventType: string, handler: (data: any) => void) => {
    messageHandlers.set(eventType, handler);
  };

  const joinRoom = (roomId: string, name: string, isController = false) => {
    send("join_room", {
      roomId,
      playerId: playerId.value,
      name,
      isController,
    });
  };

  const startGame = (roomId: string, questions: any[]) => {
    send("start_game", { roomId, questions });
  };

  const submitAnswer = (roomId: string, answer: string) => {
    send("submit_answer", {
      roomId,
      playerId: playerId.value,
      answer,
    });
  };

  const nextQuestion = (roomId: string) => {
    send("next_question", { roomId });
  };

  return {
    ws,
    isConnected,
    playerId,
    on,
    send,
    joinRoom,
    startGame,
    submitAnswer,
    nextQuestion,
  };
}
```

---

### 5. 房主控制介面 (`pages/controller.vue`)

```vue
<template>
  <div class="controller-container">
    <h1>遊戲主控中心</h1>

    <!-- 房間狀態 -->
    <div v-if="roomInfo" class="room-status">
      <h2>房間代碼: {{ roomId }}</h2>
      <p>狀態: {{ roomInfo.status }}</p>
      <p>玩家人數: {{ roomInfo.players.length }}</p>
    </div>

    <!-- 玩家列表 -->
    <div class="players-list">
      <h3>玩家清單</h3>
      <ul>
        <li v-for="player in roomInfo?.players" :key="player.playerId">
          {{ player.name }} - 分數: {{ player.score }}
          <span v-if="player.isOffline">(離線)</span>
        </li>
      </ul>
    </div>

    <!-- 遊戲控制 -->
    <div v-if="roomInfo?.status === 'waiting'" class="controls">
      <button @click="handleStartGame">開始遊戲</button>
    </div>

    <div v-if="roomInfo?.status === 'playing'" class="controls">
      <p>當前題目: {{ currentQuestionIndex + 1 }} / {{ questions.length }}</p>
      <button @click="handleNextQuestion">下一題</button>
    </div>

    <!-- 結算畫面 -->
    <div v-if="roomInfo?.status === 'finished'" class="game-over">
      <h2>遊戲結束!</h2>
      <Scoreboard :ranking="finalRanking" />
    </div>
  </div>
</template>

<script setup lang="ts">
const { on, joinRoom, startGame, nextQuestion } = useSocket();
const roomId = ref(
  "ROOM-" + Math.random().toString(36).substr(2, 6).toUpperCase(),
);
const roomInfo = ref<any>(null);
const currentQuestionIndex = ref(0);
const finalRanking = ref([]);

const questions = [
  {
    id: "1",
    text: "誰是家族中最年長的成員？",
    type: "multiple-choice",
    options: ["爺爺", "奶奶", "外公", "外婆"],
    answer: "爺爺",
    points: 10,
  },
  // ... 更多題目
];

onMounted(() => {
  joinRoom(roomId.value, "房主", true);

  on("room_info", (data) => {
    roomInfo.value = data;
  });

  on("next_question", (data) => {
    currentQuestionIndex.value = data.questionIndex;
  });

  on("game_over", (data) => {
    finalRanking.value = data.ranking;
  });
});

const handleStartGame = () => {
  startGame(roomId.value, questions);
};

const handleNextQuestion = () => {
  nextQuestion(roomId.value);
};
</script>
```

---

### 6. 玩家介面 (`pages/player.vue`)

```vue
<template>
  <div class="player-container">
    <h1>家族樹問答遊戲</h1>

    <!-- 加入房間 -->
    <div v-if="!joined" class="join-form">
      <input v-model="playerName" placeholder="輸入你的名字" />
      <input v-model="roomCode" placeholder="輸入房間代碼" />
      <button @click="handleJoin">加入遊戲</button>
    </div>

    <!-- 等待開始 -->
    <div v-if="joined && roomInfo?.status === 'waiting'">
      <p>等待房主開始遊戲...</p>
      <p>當前玩家: {{ roomInfo.players.length }} 人</p>
    </div>

    <!-- 題目顯示 -->
    <div v-if="roomInfo?.status === 'playing' && currentQuestion">
      <QuestionCard :question="currentQuestion" @submit="handleSubmit" />
      <p>你的分數: {{ playerScore }}</p>
    </div>

    <!-- 答題結果 -->
    <div v-if="answerResult" class="result">
      <p :class="answerResult.isCorrect ? 'correct' : 'wrong'">
        {{ answerResult.isCorrect ? "答對了!" : "答錯了!" }}
      </p>
      <p>正確答案: {{ answerResult.correctAnswer }}</p>
    </div>

    <!-- 最終排名 -->
    <div v-if="roomInfo?.status === 'finished'">
      <h2>遊戲結束!</h2>
      <Scoreboard :ranking="finalRanking" />
    </div>
  </div>
</template>

<script setup lang="ts">
const { on, joinRoom, submitAnswer } = useSocket();
const playerName = ref("");
const roomCode = ref("");
const joined = ref(false);
const roomInfo = ref<any>(null);
const currentQuestion = ref<any>(null);
const playerScore = ref(0);
const answerResult = ref<any>(null);
const finalRanking = ref([]);

const handleJoin = () => {
  if (!playerName.value || !roomCode.value) return;
  joinRoom(roomCode.value, playerName.value);
  joined.value = true;
};

const handleSubmit = (answer: string) => {
  submitAnswer(roomCode.value, answer);
};

onMounted(() => {
  on("room_info", (data) => {
    roomInfo.value = data;
  });

  on("next_question", (data) => {
    currentQuestion.value = data.question;
    answerResult.value = null;
  });

  on("answer_result", (data) => {
    answerResult.value = data;
    playerScore.value = data.score;
  });

  on("game_over", (data) => {
    finalRanking.value = data.ranking;
  });
});
</script>
```

---

## 📝 WebSocket 事件一覽表

### 基礎事件

| 事件名稱            | 發送方 | 接收方 | 資料結構                                                             | 說明                      |
| ------------------- | ------ | ------ | -------------------------------------------------------------------- | ------------------------- |
| `join_room`         | Client | Server | `{ type, roomId, playerId?, name, gender, birthday?, isController }` | 玩家加入房間              |
| `player_registered` | Server | Client | `{ type, playerId, nodeId }`                                         | 回傳玩家 ID 與對應節點 ID |
| `room_info`         | Server | All    | `{ type, roomId, status, players[], gameTime, isLocked }`            | 推送房間資訊              |
| `player_offline`    | Server | All    | `{ type, playerId, name }`                                           | 玩家離線通知              |

### 遊戲控制事件

| 事件名稱       | 發送方     | 接收方 | 資料結構                               | 說明                 |
| -------------- | ---------- | ------ | -------------------------------------- | -------------------- |
| `start_game`   | Controller | Server | `{ type, roomId }`                     | 開始遊戲（鎖定房間） |
| `lock_room`    | Server     | All    | `{ type, isLocked }`                   | 通知房間已鎖定       |
| `phase_change` | Server     | All    | `{ type, phase, remainingTime }`       | 階段切換通知         |
| `game_over`    | Server     | All    | `{ type, familyTree, ranking[], mvp }` | 遊戲結束與結果       |

### 關係掃描階段 (Relationship Scan)

| 事件名稱                 | 發送方 | 接收方 | 資料結構                                               | 說明                               |
| ------------------------ | ------ | ------ | ------------------------------------------------------ | ---------------------------------- |
| `relationship_question`  | Server | Client | `{ type, questionId, player1, player2, question }`     | 推送關係問題卡片                   |
| `relationship_answer`    | Client | Server | `{ type, questionId, playerId, answer }`               | 回答關係（如：父子、母女、兄弟等） |
| `relationship_confirmed` | Server | All    | `{ type, player1, player2, relationship, newNodes[] }` | 關係確認，生成虛擬節點             |

### 資料搶答階段 (Data Sprint)

| 事件名稱          | 發送方 | 接收方 | 資料結構                                    | 說明                 |
| ----------------- | ------ | ------ | ------------------------------------------- | -------------------- |
| `task_assigned`   | Server | Client | `{ type, task }`                            | 分派任務給玩家       |
| `task_lock`       | Client | Server | `{ type, taskId, playerId }`                | 鎖定任務（開始作答） |
| `task_submit`     | Client | Server | `{ type, taskId, playerId, data }`          | 提交任務答案         |
| `task_skip`       | Client | Server | `{ type, taskId, playerId }`                | 跳過任務             |
| `task_completed`  | Server | All    | `{ type, taskId, nodeId, filledBy, score }` | 任務完成通知         |
| `task_reassigned` | Server | Client | `{ type, task }`                            | 任務重新分派         |

### 衝突解決事件

| 事件名稱              | 發送方 | 接收方              | 資料結構                                         | 說明         |
| --------------------- | ------ | ------------------- | ------------------------------------------------ | ------------ |
| `conflict_detected`   | Server | Conflicting Players | `{ type, conflictId, nodeId, answer1, answer2 }` | 偵測到衝突   |
| `conflict_resolution` | Client | Server              | `{ type, conflictId, playerId, chosenAnswer }`   | 衝突解決選擇 |
| `conflict_resolved`   | Server | All                 | `{ type, conflictId, finalAnswer }`              | 衝突已解決   |

### 大揭曉階段 (Reveal)

| 事件名稱                 | 發送方 | 接收方 | 資料結構                        | 說明         |
| ------------------------ | ------ | ------ | ------------------------------- | ------------ |
| `reveal_start`           | Server | All    | `{ type, familyTree }`          | 開始揭曉族譜 |
| `reveal_animation_frame` | Server | All    | `{ type, frameData }`           | 動畫播放幀   |
| `reveal_complete`        | Server | All    | `{ type, stats, completeness }` | 揭曉完成統計 |

**注意**：所有訊息都使用 JSON 格式，且必須包含 `type` 欄位以區分事件類型。

---

## 🔒 斷線重連機制

### 實作流程

1. **初次連線**: Server 產生 `playerId`，回傳給 Client 儲存至 `localStorage`
2. **斷線**: WebSocket 斷線時，Server 將玩家標記為 `isOffline: true`，但保留資料
3. **重連**: Client 重新連線時攜帶 `playerId`，Server 比對成功後恢復狀態
4. **清理**: 離線超過 5 分鐘的玩家會被自動清除

### localStorage 結構

```javascript
{
  "playerId": "uuid-xxxx-xxxx-xxxx"
}
```

### 自動重連邏輯

客戶端在 WebSocket 關閉時會自動嘗試重連：

```typescript
ws.value.onclose = () => {
  isConnected.value = false;
  console.log("[WebSocket] 已斷線，3秒後重連...");
  setTimeout(connectWebSocket, 3000); // 3秒後自動重連
};
```

---

## 🧪 測試流程

### 1. 本地測試

```bash
# 啟動開發伺服器
bun run dev

# 開啟多個瀏覽器視窗測試:
# - 視窗1: http://localhost:3000/controller (房主)
# - 視窗2-N: http://localhost:3000/player (玩家)
```

### 2. WebSocket 連線測試

使用瀏覽器開發者工具 (F12) 檢查 WebSocket 連線：

1. 開啟 Network 面板
2. 選擇 WS (WebSocket) 分頁
3. 觀察連線狀態與訊息傳送

### 3. 測試案例

#### 基礎功能測試

- [ ] 房主創建房間並設定遊戲時間
- [ ] 玩家使用代碼加入房間（輸入姓名、性別、生日）
- [ ] 多位玩家同時加入房間
- [ ] 房主開始遊戲（房間鎖定）
- [ ] 嘗試在鎖定後加入（應轉為旁觀者）

#### 關係掃描階段測試

- [ ] 收到關係問題卡片
- [ ] 回答玩家間的關係（如：父子、兄弟）
- [ ] 驗證系統自動生成虛擬節點
- [ ] 測試多組關係建立

#### 資料搶答階段測試

- [ ] 收到節點填寫任務
- [ ] 鎖定任務並填寫資料
- [ ] 測試任務獨佔機制（其他人看不到被鎖定的任務）
- [ ] 跳過任務（驗證任務重新分派給其他玩家）
- [ ] 提交任務並獲得分數
- [ ] 測試衝突偵測（兩人填寫不同答案）
- [ ] 解決衝突（雙方確認正確答案）

#### 演算法測試

- [ ] 驗證任務分派的鄰近優先原則
- [ ] 測試 DAG 環路檢測
- [ ] 驗證性別與關係的一致性
- [ ] 測試計分系統準確性

#### 大揭曉階段測試

- [ ] 遊戲時間結束自動進入揭曉
- [ ] 族譜動畫正確播放
- [ ] 顯示完整族譜 DAG
- [ ] 顯示 MVP 與排名
- [ ] 顯示家族完整度統計

#### 特殊情境測試

- [ ] 測試斷線重連功能（關閉/重開瀏覽器分頁）
- [ ] 驗證房間自動清理機制
- [ ] 測試大量玩家同時作答
- [ ] 驗證時間倒數準確性

---

## 🚀 部署建議

### 部署平台選擇

由於使用 Nitro 原生 WebSocket，建議使用以下平台：

1. **Vercel**: 支援 Nuxt 3 及 WebSocket (需啟用 Edge Runtime)
2. **Railway / Render / Fly.io**: 原生支援長連線 WebSocket
3. **Cloudflare Pages**: 支援 WebSocket (Workers 模式)
4. **自架伺服器**: 使用 PM2 管理 Node.js 進程

### 環境變數

```bash
# .env
NUXT_PUBLIC_WEBSOCKET_URL=wss://your-domain.com/ws
```

### Vercel 部署設定

在 `nuxt.config.ts` 中設定：

```typescript
export default defineNuxtConfig({
  nitro: {
    preset: "vercel-edge", // 使用 Edge Runtime
    experimental: {
      websocket: true,
    },
  },
});
```

---

## ⚠️ 注意事項

1. **記憶體管理**: 由於使用 in-memory 儲存，伺服器重啟會清空所有資料
2. **擴展性**: 單機部署有上限，多機部署需使用 Redis Adapter 實現跨節點通訊
3. **安全性**: 生產環境需加入：
   - 房間密碼保護
   - 請求頻率限制（防刷機制）
   - 輸入驗證與過濾
4. **效能**: 大量玩家時考慮：
   - 使用 Redis 儲存狀態
   - 實作資料庫持久化
   - 負載均衡與水平擴展

---

## 📚 參考資源

- [Nitro WebSocket 官方文件](https://nitro.unjs.io/guide/websocket)
- [CrossWS (Nitro WebSocket 實作)](https://crossws.unjs.io/)
- [Nuxt 3 Server Engine](https://nuxt.com/docs/guide/concepts/server-engine)
- [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

---

## 🎉 開發完成檢查清單

### 基礎架構

- [ ] Nitro WebSocket 設定啟用
- [ ] WebSocket 路由處理器建立 (`server/routes/ws.ts`)
- [ ] 遊戲狀態管理實作 (`server/utils/gameState.ts`)
- [ ] 房間創建與管理邏輯
- [ ] 玩家加入與重連機制
- [ ] 斷線自動重連處理
- [ ] 離線玩家自動清理機制

### 資料結構與演算法

- [ ] 族譜節點結構定義 (`types/game.d.ts`)
- [ ] DAG 驗證器實作 (`server/utils/dagValidator.ts`)
- [ ] 環路檢測功能
- [ ] 關係一致性驗證
- [ ] 任務分派演算法 (`server/utils/taskAssigner.ts`)
- [ ] 距離計算 (BFS)
- [ ] 關係鄰近優先邏輯
- [ ] 任務跳過與重新分派
- [ ] 衝突偵測機制
- [ ] 計分系統實作 (`server/utils/scoreCalculator.ts`)

### 遊戲階段實作

- [ ] 階段一：等候室功能
  - [ ] 房間創建與設定
  - [ ] 玩家加入與資料填寫
  - [ ] 房間鎖定機制
  - [ ] 旁觀者模式
- [ ] 階段二：關係掃描
  - [ ] 關係問題卡片生成
  - [ ] Tinder 式 UI 實作
  - [ ] 關係確認與節點生成
  - [ ] 虛擬節點自動創建
- [ ] 階段三：資料搶答
  - [ ] 任務佇列管理
  - [ ] 任務獨佔鎖定
  - [ ] 任務分派推送
  - [ ] 跳過功能實作
  - [ ] 衝突解決介面
- [ ] 階段四：大揭曉
  - [ ] 族譜視覺化動畫
  - [ ] 結果統計計算
  - [ ] MVP 評選
  - [ ] 完整度分析

### 客戶端介面

- [ ] WebSocket composable (`composables/useSocket.ts`)
- [ ] 房主控制介面 (`pages/controller.vue`)
- [ ] 玩家遊戲介面 (`pages/player.vue`)
- [ ] 旁觀者介面 (`pages/observer.vue`)
- [ ] 關係卡片組件 (`components/RelationshipCard.vue`)
- [ ] 任務卡片組件 (`components/TaskCard.vue`)
- [ ] 族譜視覺化組件 (`components/FamilyTreeVisualization.vue`)
- [ ] 衝突解決組件 (`components/ConflictResolver.vue`)
- [ ] 計分板組件 (`components/Scoreboard.vue`)

### 測試與優化

- [ ] 多人連線測試驗證
- [ ] DAG 演算法單元測試
- [ ] 任務分派邏輯測試
- [ ] 衝突處理流程測試
- [ ] UI/UX 優化
- [ ] 效能優化（大量節點處理）
- [ ] 生產環境部署

---

## 🔍 除錯建議

### 常見問題排查

1. **WebSocket 無法連線**
   - 檢查 `nuxt.config.ts` 是否啟用 `websocket: true`
   - 確認瀏覽器 console 沒有 CORS 錯誤
   - 驗證伺服器端路由 `server/routes/ws.ts` 存在

2. **斷線後無法重連**
   - 檢查 `localStorage` 是否正確儲存 `playerId`
   - 確認自動重連邏輯是否觸發 (查看 console log)
   - 驗證伺服器端是否正確保留離線玩家資料

3. **訊息無法接收**
   - 確認 `messageHandlers` 是否正確註冊
   - 檢查訊息 `type` 欄位是否一致
   - 使用瀏覽器開發者工具檢查 WebSocket 訊息

4. **DAG 環路問題**
   - 使用 `detectCycle()` 函數檢測環路
   - 檢查父母與子女關係是否正確設定
   - 驗證新增關係前是否執行驗證

5. **任務分派異常**
   - 檢查 `calculateDistance()` 函數是否正確計算距離
   - 驗證玩家節點是否正確建立在 DAG 中
   - 確認任務佇列是否正確維護

6. **衝突未被偵測**
   - 檢查 `detectConflict()` 邏輯
   - 確認節點資料的更新時機
   - 驗證 `filledBy` 欄位是否正確記錄

7. **族譜視覺化錯誤**
   - 檢查 DAG 資料結構完整性
   - 驗證節點關係連結是否正確
   - 確認動畫播放順序邏輯

### 效能優化建議

- **大量節點處理**：當族譜節點超過 100 個時，考慮實作虛擬滾動
- **任務佇列**：使用優先級佇列（Heap）優化任務分派
- **距離計算快取**：快取常用的距離計算結果
- **WebSocket 訊息批次**：合併多個小訊息減少網路開銷

---

**文件版本**: v2.0 (Family Tree Connect - Nitro WebSocket)  
**遊戲規格**: v1.1  
**建立日期**: 2026-02-16  
**維護者**: Development Team
