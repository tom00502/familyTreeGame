# 資料結構統一參考

本文檔統一定義所有核心資料結構、型別定義、介面規格，避免重複定義。

---

## 🎮 遊戲核心結構

### Room (房間)

```typescript
interface Room {
  // 識別與狀態
  roomId: string; // 房間 ID (8字元大寫)
  roomStatus:
    | "idle" // 未啟動
    | "waiting" // 等待中
    | "relationship-scan" // 關係掃描中
    | "in-game" // 遊戲進行中
    | "finished" // 結算中
    | "destroyed"; // 已銷毀

  // 房間配置
  hostId: string; // 房主 ID
  gameDurationSeconds: 90 | 120 | 180; // 遊戲時長
  isLocked: boolean; // 是否鎖定（遊戲開始後鎖定）

  // 玩家管理
  players: Map<string, Player>; // 玩家字典 (playerId -> Player)
  spectators: Map<string, Spectator>; // 旁觀者字典

  // 遊戲狀態
  gameStartTime: number; // 遊戲開始時間戳
  gameEndTime: number | null; // 遊戲結束時間戳
  gameDuration: number; // 實際遊戲耗時(毫秒)

  // 族譜與任務
  familyTree: Map<string, FamilyNode>; // 族譜節點字典
  taskQueue: TaskItem[]; // 待派發任務隊列

  // 歷史記錄
  answerHistory: AnswerRecord[]; // 答題紀錄(最多 50 筆)

  // 元數據
  createdAt: number; // 房間建立時間
  lastActivityAt: number; // 最後活動時間
  isExpired: boolean; // 是否已過期(24 小時)
}
```

### Player (玩家)

```typescript
interface Player {
  // 身份識別
  playerId: string; // UUID 玩家 ID
  socketId: string; // 當前 WebSocket 連線 ID

  // 基本信息
  name: string; // 姓名 (2-10 字元)
  gender: "M" | "F"; // 性別
  birthday: string; // 生日 (YYYY/MM/DD)

  // 角色與狀態
  isHost: boolean; // 是否為房主
  isObserver: boolean; // 是否為旁觀者
  connectionStatus:
    | "connected" // 已連線
    | "disconnected" // 暫時斷線 (< 5 min)
    | "offline"; // 永久離線 (> 5 min)

  // 遊戲進度
  score: number; // 當前分數
  contributions: {
    relationshipQuestions: number; // 關係確認回答數
    nodeNaming: number; // 節點命名貢獻
    attributeFilling: number; // 屬性填充貢獻
    nodeConvergence: number; // 節點匯聚確認
    ageOrdering: number; // 排序確認
  };

  // 連線管理
  joinedAt: number; // 加入房間時間戳
  lastHeartbeatAt: number; // 最後心跳時間
  reconnectAttempts: number; // 重連次數

  // 個人狀態
  currentQuestionId: string | null; // 目前回答的問題 ID
  answeredQuestions: Set<string>; // 已回答問題集合
}
```

### Spectator (旁觀者)

```typescript
interface Spectator {
  // 身份識別
  spectatorId: string; // UUID 旁觀者 ID
  socketId: string; // WebSocket 連線 ID

  // 加入方式
  joinMethod: "direct" | "via_member"; // 直接加入或自動轉換
  connectionAttempts: number; // 連線嘗試次數
  joinedAt: number; // 加入時間戳

  // 狀態
  connectionStatus: "connected" | "disconnected";

  // 觀看偏好
  viewingPreferences?: {
    showDetailedScores: boolean; // 詳細分數
    showPlayerNames: boolean; // 玩家姓名
    autoScroll: boolean; // 自動捲動
  };
}
```

---

## 👨‍👩‍👧‍👦 族譜結構

### FamilyNode (族譜節點)

```typescript
interface FamilyNode {
  // 識別
  id: string; // 唯一節點 ID

  // 個人信息
  name: string | null; // 姓名 (虛擬節點可能為 null)
  gender: "M" | "F" | null; // 性別
  birthday: string | null; // 生日 (YYYY/MM/DD)

  // 節點類型與狀態
  isVirtual: boolean; // 是否為虛擬節點
  isPlayer: boolean; // 是否為玩家節點
  playerId?: string; // 對應的玩家 ID (若為玩家節點)

  // 關鍵路徑
  isOnKeyPath: boolean; // 是否在關鍵路徑上
  expansionType?: "FULL" | "TERMINAL"; // 擴張類型

  // 親屬關係
  father?: string; // 父親節點 ID
  mother?: string; // 母親節點 ID
  spouse?: string; // 配偶節點 ID
  children: string[]; // 子女節點 ID 列表

  // 元數據
  createdBy?: string; // 創建者玩家 ID
  createdAt: number; // 建立時間戳
  confirmedAt?: number; // 確認時間戳
  confidenceScore?: number; // 信心分數 (0-100)
}
```

### FamilyEdge (親屬關係邊)

```typescript
interface FamilyEdge {
  id: string; // 邊唯一 ID
  sourceId: string; // 源節點 ID
  targetId: string; // 目標節點 ID
  relationship:
    | "parent" // 父母
    | "child" // 子女
    | "spouse" // 配偶
    | "sibling" // 兄弟姐妹
    | "cousin" // 表親
    | "ancestor" // 祖先
    | "descendant"; // 後代

  direction: "up" | "down" | "sideways"; // 方向
  isConfirmed: boolean; // 是否已確認
  confirmedBy: string[]; // 確認者玩家 ID 列表
  conflictCount: number; // 衝突計數
}
```

---

## ❓ 任務與提問結構

### TaskItem (待派發任務)

```typescript
interface TaskItem {
  taskId: string; // 任務 ID

  taskType:
    | "relationship_check" // 第一階段：關係確認
    | "node_naming" // 第二階段：節點命名
    | "attribute_filling" // 第二階段：屬性填充
    | "node_convergence" // 第二階段：節點匯聚
    | "age_ordering" // 第二階段：排序確認
    | "data_verification"; // 第三階段：資料驗證

  // 問題內容
  question: string; // 完整問題文本
  questionFormat: string; // 問題格式 (見 qa_phase*.md)

  // 目標對象
  targetPlayerId?: string; // 被問的玩家 (若專人回答)
  targetNodeIds?: string[]; // 涉及的節點 ID 列表

  // 狀態與鎖定
  status: "pending" | "assigned" | "completed"; // 任務狀態
  isLocked: boolean; // 是否被獨佔(鎖定)
  lockedBy?: string; // 鎖定者玩家 ID
  lockedAt?: number; // 鎖定時間
  lockExpiresAt?: number; // 鎖定過期時間(30 秒)

  // 優先級
  priority: number; // 優先級 (1-10, 10 最高)
  dependencies: string[]; // 依賴的任務 ID 列表

  // 元數據
  createdAt: number; // 建立時間
  assignedAt?: number; // 派發時間
  completedAt?: number; // 完成時間
}
```

### Question (問題)

```typescript
interface Question {
  questionId: string; // 問題 ID

  phase: 1 | 2 | 3; // 階段
  type: string; // 問題類型

  // 內容
  template: string; // 問題模板字符
  parameters: Record<string, string>; // 參數替換
  fullText: string; // 完整文本

  // 選項(若適用)
  options?: string[]; // 可選答案列表

  // 約束
  playerConstraints?: {
    gender?: "M" | "F"; // 被問玩家性別
    relationshipRange?: [number, number]; // 親等範圍
  };

  // 元數據
  createdAt: number;
  isActive: boolean;
}
```

---

## 📝 答題相關結構

### AnswerRecord (答題紀錄)

```typescript
interface AnswerRecord {
  answerId: string; // 唯一紀錄 ID
  questionId: string; // 對應問題 ID

  // 回答者
  playerId: string; // 玩家 ID
  playerName: string; // 玩家姓名

  // 答題內容
  question: string; // 完整問題文本
  answer: string | null; // 答案內容(null = 跳過)
  status: "confirmed" | "skipped"; // 答題狀態

  // 時序
  answeredAt: number; // 答題時間戳
  index: number; // 歷史中的位置
}
```

### ScoreRecord (計分紀錄)

```typescript
interface ScoreRecord {
  recordId: string; // 紀錄 ID

  playerId: string; // 玩家 ID
  playerName: string; // 玩家姓名

  // 計分項目
  baseScore: number; // 基礎分數
  nodeNameBonus: number; // 節點命名加分
  relationshipBonus: number; // 關係確認加分
  accuracyPenalty: number; // 準確度扣分

  totalScore: number; // 最終分數

  // 排名
  rank: number; // 最終排名
  isMVP: boolean; // 是否 MVP

  // 元數據
  calculatedAt: number; // 計算時間
  basedOn: {
    totalAnswers: number; // 總回答數
    correctAnswers: number; // 準確回答數
    contributions: any; // 貢獻統計
  };
}
```

---

## 🔐 連線管理結構

### ConnectionState (連線狀態)

```typescript
interface ConnectionState {
  playerId: string;
  socketId: string;

  // 連線狀態
  status: "connecting" | "connected" | "disconnected" | "reconnecting";

  // 心跳管理
  lastHeartbeatAt: number; // 最後心跳時間
  heartbeatMissed: number; // 連續遺漏心跳數
  heartbeatInterval: number; // 心跳間隔(毫秒) = 30000
  heartbeatTimeout: number; // 心跳逾時(毫秒) = 60000

  // 重連管理
  reconnectAttempts: number; // 重連次數 (0-10)
  nextReconnectTime: number; // 下次重連時間
  reconnectDelays: number[]; // 指數退避延遲序列
  maxReconnectAttempts: number; // 最大重連次數 = 10

  // 待決訊息
  pendingMessages: any[]; // 離線時緩存的訊息

  // 元數據
  connectedAt: number; // 連線時間
  disconnectedAt?: number; // 斷線時間
}
```

### ReconnectionConfig (重連配置)

```typescript
interface ReconnectionConfig {
  // 指數退避參數
  initialDelay: number; // 初始延遲 = 3000 毫秒
  multiplier: number; // 乘數 = 1.5
  maxRetries: number; // 最大重試次數 = 10

  // 計算結果 (ms):
  // [3000, 4500, 6750, 10125, 15187.5, 22781.25, 34171.875, 51257.8125, 76886.71875, 115330.078125]

  connectionTimeout: number; // 連線逾時 = 30000 ms
  heartbeatInterval: number; // 心跳間隔 = 30000 ms
  heartbeatTimeout: number; // 心跳逾時 = 60000 ms (2 beats)

  // 特殊條件
  shouldResumeOnReconnect: boolean; // 重連後恢復狀態 = true
  shouldRestorePlayerId: boolean; // 恢復玩家 ID = true (localStorage)
  maxPendingMessages: number; // 待決訊息上限 = 100
}
```

---

## 📊 計分相關結構

### ScoringConfig (計分配置)

```typescript
interface ScoringConfig {
  // 基礎分數
  basePoints: number; // 完成遊戲基礎分 = 100

  // 加分項(權重)
  relationshipCorrect: {
    points: number; // = 10
    weight: number; // = 1.0
  };
  nodeNamed: {
    points: number; // = 5
    weight: number; // = 1.0
  };
  attributeFilled: {
    points: number; // = 3
    weight: number; // = 1.0
  };

  // 修飾符
  accuracy: {
    perfect: number; // 100% 準確 = 1.5x
    good: number; // 80-99% = 1.2x
    fair: number; // 50-79% = 1.0x
    poor: number; // < 50% = 0.8x
  };

  // MVP 條件
  mvpCriteria: {
    minimumScore: number; // = 500
    minimumContributions: number; // = 20
    bonusPoints: number; // = 100
  };

  // 排列方式
  byTotalScore: boolean; // 按最終分數排名 = true
}
```

---

## 🎯 其他全域常數

```typescript
export const CONSTANTS = {
  // 房間配置
  ROOM_ID_LENGTH: 8,
  ROOM_EXPIRATION_HOURS: 24,
  ROOM_CLEANUP_INTERVAL_MS: 60 * 1000, // 60 秒掃描

  // 玩家設定
  OFFLINE_THRESHOLD_MS: 5 * 60 * 1000, // 5 分鐘判定離線
  HEARTBEAT_INTERVAL_MS: 30 * 1000, // 30 秒
  HEARTBEAT_TIMEOUT_MS: 60 * 1000, // 60 秒

  // 答題歷史
  MAX_ANSWER_HISTORY_SIZE: 50,
  ANSWER_SYNC_INTERVAL_MS: 5 * 1000, // 5 秒推送給旁觀者

  // 任務鎖定
  TASK_LOCK_TIMEOUT_MS: 30 * 1000, // 30 秒

  // 重連設定
  INITIAL_RECONNECT_DELAY_MS: 3000,
  RECONNECT_MULTIPLIER: 1.5,
  MAX_RECONNECT_RETRIES: 10,
  CONNECTION_TIMEOUT_MS: 30 * 1000,

  // 速率限制
  MAX_ANSWERS_PER_SECOND: 5,
  RATE_LIMIT_WINDOW_MS: 1000,

  // 驗證
  PLAYER_NAME_MIN_LENGTH: 2,
  PLAYER_NAME_MAX_LENGTH: 10,
  BIRTHDAY_FORMAT: "YYYY/MM/DD",
};
```

---

**文件版本**：1.0  
**最後更新**：2026-02-26
