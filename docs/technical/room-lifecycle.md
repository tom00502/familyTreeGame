# 房間生命週期管理

本文檔描述房間的完整生命週期，包括建立、維護、清理、銷毀等伺服器端管理邏輯。

---

## 🔄 房間生命週期狀態轉換

```
[初始化]
   ↓
建立階段 (CREATING)
   ↓ 房主輸入房間名稱與遊戲時間，點擊建立
   ✓ roomId 生成、分享連結生成
   ✓ 房間狀態轉為 Waiting
   ✓ 伺服器記憶體中存儲房間對象
   ↓
活躍階段 (ACTIVE)
   ├─ 等待中 (Waiting)
   │   ├─ 玩家加入與資料輸入
   │   └─ 房主準備啟動遊戲
   │
   ├─ 進行中 (In-Game / Relationship-Scan)
   │   ├─ 遊戲計時進行
   │   ├─ 答題與計分
   │   └─ 新加入者進入旁觀者模式
   │
   └─ 結算中 (Finished)
       ├─ 展示最終族譜
       ├─ 展示排行榜
       └─ 玩家查看結果
   ↓
清理階段 (CLEANUP)
   ± 返回大廳 → 房主可重啟遊戲，回到 Waiting
   ± 自動清理 → 24 小時無活動自動刪除
   ↓
銷毀階段 (DESTROYED)
   ✓ 房間從記憶體移除
   ✓ 玩家連線自動斷開
   ✓ 資料歸檔（若有持久層）
```

---

## 💾 房間初始化 (CREATING)

### 觸發條件

房主在首頁填寫房間名稱與遊戲時間，點擊「建立房間」

### 初始化步驟

```typescript
function createRoom(roomName: string, gameTime: number) {
  // 1. 生成唯一房間 ID
  const roomId = crypto.randomUUID().substring(0, 8).toUpperCase();

  // 驗證唯一性（重試機制）
  if (gameState.rooms.has(roomId)) {
    return createRoom(roomName, gameTime); // 遞歸重試
  }

  // 2. 初始化房間對象
  const room: Room = {
    roomId,
    name: roomName,
    gameDuration: gameTime,

    // 狀態管理
    status: "waiting",
    hostId: requestingPlayerId,

    // 玩家管理
    players: new Map(),
    observers: new Map(),

    // 遊戲數據
    gameStartTime: null,
    gameEndTime: null,
    familyTree: { nodes: new Map(), relationships: [] },

    // 元數據
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 小時後過期
  };

  // 3. 存儲到伺服器記憶體
  gameState.rooms.set(roomId, room);

  // 4. 生成分享連結
  const shareLink = `${process.env.BASE_URL}/room/${roomId}`;

  return { roomId, shareLink };
}
```

### 初始化的資料結構

```typescript
interface Room {
  // 基本識別
  roomId: string; // 唯一房間 ID (8 位大寫英數)
  name: string; // 房間名稱
  gameDuration: number; // 遊戲時長(秒)：90 | 120 | 180

  // 狀態管理
  status: RoomStatus; // waiting | relationship-scan | in-game | finished
  hostId: string; // 房主 playerId
  isLocked: boolean; // 遊戲進行中，房間鎖定

  // 玩家與觀眾
  players: Map<playerId, Player>;
  observers: Map<spectatorId, Spectator>;

  // 遊戲數據
  gameStartTime: number | null; // 遊戲啟動時間戳
  gameEndTime: number | null; // 遊戲結束時間戳
  familyTree: FamilyTree; // 族譜資料結構
  taskQueue: Task[]; // 待派發任務隊列
  completedTasks: CompletedTask[];

  // 元數據
  createdAt: number; // 房間建立時間戳
  updatedAt: number; // 最後更新時間戳
  expiresAt: number; // 房間過期時間戳（24 小時）
}
```

---

## 🎮 活躍階段運營

### 等待中 (Waiting)

**狀態特性**：

- 玩家可加入
- 房間未鎖定
- 無計時進行
- `updatedAt` 隨玩家加入而更新

**維持時間**：~15-30 分鐘（由房主決定）

**伺服器維護**：

- 每 30 秒檢查房間是否有新活動
- 無活動超過 15 分鐘的房間發送警告：「房間即將自動關閉」

### 進行中 (In-Game)

**狀態特性**：

- 房間鎖定（`isLocked: true`）
- 計時器啟動（`gameStartTime = Date.now()`）
- 新加入者轉為旁觀者
- 每秒更新 `updatedAt`

**生命週期**：

```
[房主點擊"開始遊戲"]
  ↓
status = "relationship-scan"
isLocked = true
gameStartTime = Date.now()
  ↓
[計時進行，派發題目]
  ↓ (遊戲時間耗盡)
[所有階段完成或超時]
  ↓
gameEndTime = Date.now()
status = "finished"
```

**關鍵參數**：

- 初值：`gameDuration = 90 | 120 | 180` 秒
- 倒數公式：`remainingTime = gameDuration - (Date.now() - gameStartTime) / 1000`
- 結束判定：`remainingTime <= 0 || allPlayersFinished`

### 結算中 (Finished)

**狀態特性**：

- 遊戲計時停止
- 顯示最終結果（族譜、排行榜）
- 允許玩家查看回放
- 房主可啟動新遊戲或返回大廳

**保留時間**：60 秒自動轉入清理階段

---

## 🧹 房間清理策略

### 自動清理規則

#### 規則 1：使用不活躍房間

**條件**：房間建立後 24 小時內無任何活動

**判定邏輯**：

```typescript
function shouldCleanupRoom(room: Room): boolean {
  const now = Date.now();
  const inactiveTime = now - room.updatedAt;
  return inactiveTime > 24 * 60 * 60 * 1000; // 24 小時
}
```

**檢查頻率**：每小時掃描一次（或可設為每 30 分鐘）

**清理流程**：

```
1. 檢測到房間過期
   ↓
2. 若房主在線，發送警告通知：「房間已 24 小時未活動，將在 1 小時後自動關閉」
   ↓
3. 等待 1 小時，若仍無活動
   ↓
4. 執行清理：
   ├─ 斷開所有玩家連線
   ├─ 發送 "room:closed" 事件
   ├─ 從記憶體移除房間
   └─ 可選：歸檔至資料庫
```

#### 規則 2：遊戲進行中房間超時

**條件**：遊戲進行 > 10 分鐘（防止伺服器因計時器掛起佔用資源）

**動作**：

- 強制結束遊戲
- 執行計分邏輯
- 轉入 Finished 狀態
- 發送通知：「遊戲因超時自動結束」

#### 規則 3：房間為空超過 5 分鐘

**條件**：

- 所有玩家都離線
- 無旁觀者
- 房間非 Waiting 狀態

**動作**：立即清理（無等待時間）

### 清理實現

```typescript
// 伺服器啟動時定期檢查
setInterval(() => {
  const now = Date.now();

  gameState.rooms.forEach((room, roomId) => {
    // 檢查 1：24 小時未活動
    if (now - room.updatedAt > 24 * 60 * 60 * 1000) {
      handleRoomExpiration(room);
    }

    // 檢查 2：遊戲超時
    if (room.status === "in-game" && room.gameStartTime) {
      const elapsedSeconds = (now - room.gameStartTime) / 1000;
      if (elapsedSeconds > room.gameDuration + 60) {
        // 容許 60 秒緩衝
        forceFinishGame(room);
      }
    }

    // 檢查 3：房間為空
    if (room.players.size === 0 && room.observers.size === 0) {
      if (room.status !== "waiting" && now - room.updatedAt > 5 * 60 * 1000) {
        cleanupRoom(roomId);
      }
    }
  });
}, 60 * 1000); // 每分鐘檢查一次
```

---

## 📝 房間狀態持久化（可選）

若需要支援伺服器重啟後房間恢復，可實現以下機制：

### 快照策略

每 5 分鐘或每個重大狀態變更後：

1. 序列化房間對象為 JSON
2. 寫入持久層（資料庫 / 檔案系統）
3. 記錄快照時間戳

### 啟動恢復

伺服器啟動時：

1. 掃描所有未完成的房間快照
2. 對於 "in-game" 房間：計算遺漏時間，恢復計時器
3. 對於 "finished" 房間：跳過恢復（已完成）
4. 對於 "waiting" 房間：無需恢復（無狀態）

---

## 📊 記憶體費用估算

### 單房間佔用

```
基本資料結構：~2 KB
玩家 × 5：5 × 500 B = 2.5 KB
族譜節點 × 30：30 × 800 B = 24 KB
任務隊列 × 50 項：50 × 200 B = 10 KB
─────────────────────────────
單房間總計：~38.5 KB
```

### 系統容量建議

| 規模          | 記憶體需求 |
| ------------- | ---------- |
| 100 同時房間  | ~4 MB      |
| 1000 同時房間 | ~40 MB     |
| 5000 同時房間 | ~200 MB    |

**優化建議**：

- 使用 Redis 作為房間狀態服務層（可橫向擴展）
- 定期清理過期房間
- 考慮分離「活躍房間」與「存檔房間」

---

## 🔔 房間事件生命週期

| 事件              | 時機                 | 目標     |
| ----------------- | -------------------- | -------- |
| `room:created`    | 房間初始化完成       | 房主     |
| `game:started`    | 房主點擊開始         | 所有玩家 |
| `stage_completed` | 各階段完成時         | 所有玩家 |
| `game:finished`   | 時間耗盡或手動結束   | 所有玩家 |
| `room:closing`    | 房間準備關閉（警告） | 房主     |
| `room:closed`     | 房間已關閉           | 所有連線 |

---

## 🛡️ 容錯機制

### 時鐘漂移

**問題**：玩家端與伺服器端時鐘不同步

**解決**：

- 伺服器發送 `gameStartTime` 給所有玩家
- Client 端計算 `elapsedTime = serverTime - gameStartTime`
- 定期同步：每 10 秒檢查一次並糾正偏差

### 玩家離線期間房間狀態變更

**問題**：玩家離線，房間狀態已變更（例 Waiting → In-Game）

**解決**：

- 玩家重連時，伺服器發送完整的 `sync:state`
- Client 檢測狀態變更，切換 UI
- 若遊戲已進行，自動轉為旁觀者模式

### 房間銷毀期間玩家試圖加入

**問題**：清理線程正在刪除房間，此時玩家發送加入請求

**解決**：

- 使用互斥鎖（Mutex）保護房間刪除操作
- 加入檢查時必須先鎖定房間對象
- 銷毀前等待所有待處理操作完成

---

## 📋 操作檢查清單

### 房間建立檢查

- [ ] roomId 驗證唯一性
- [ ] 分享連結格式正確
- [ ] expiresAt 設定為 24 小時後
- [ ] createdAt 與 updatedAt 初始化
- [ ] 房主身份正確設定

### 遊戲進行檢查

- [ ] gameStartTime 設定正確
- [ ] 計時邏輯無誤差
- [ ] 超時邊界情況處理
- [ ] 狀態轉換邏輯完整

### 清理檢查

- [ ] 24 小時無活動正確檢測
- [ ] 超時房間正確終止
- [ ] 玩家連線正確斷開
- [ ] 記憶體正確釋放

---

**文件版本**：1.0  
**最後更新**：2026-02-26
