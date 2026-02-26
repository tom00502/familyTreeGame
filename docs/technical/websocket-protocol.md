# WebSocket 協議規格書

本文檔定義系統中所有 WebSocket 事件的完整規格，包括事件名稱、方向、資料結構、觸發條件。

---

## 📡 事件矩陣概覽

### 房間建立與管理事件

| 事件名稱       | 方向            | 觸發者 | 用途             |
| -------------- | --------------- | ------ | ---------------- |
| `room:create`  | Client → Server | 房主   | 建立新房間       |
| `room:created` | Server → Client | 系統   | 回傳房間建立結果 |

### 玩家加入與資料事件

| 事件名稱               | 方向            | 觸發者 | 用途               |
| ---------------------- | --------------- | ------ | ------------------ |
| `member:typing`        | Client → Server | 玩家   | 通知單位即將輸入   |
| `member:typing_notify` | Server → All    | 系統   | 廣播玩家正在輸入中 |
| `member:join`          | Client → Server | 玩家   | 提交資料加入房間   |
| `member:joined`        | Server → All    | 系統   | 廣播新玩家加入     |
| `player_offline`       | Server → All    | 系統   | 廣播玩家離線       |
| `reconnected`          | Server → All    | 系統   | 廣播玩家重連       |

### 遊戲流程事件

| 事件名稱          | 方向            | 觸發者 | 用途                       |
| ----------------- | --------------- | ------ | -------------------------- |
| `game:start`      | Client → Server | 房主   | 啟動遊戲                   |
| `game:started`    | Server → All    | 系統   | 確認遊戲已啟動             |
| `stage_completed` | Server → All    | 系統   | 通知階段完成，進入下一階段 |
| `sync:state`      | Server → All    | 系統   | 同步房間完整狀態           |

### 遊戲答題事件

| 事件名稱                 | 方向            | 觸發者 | 用途                     |
| ------------------------ | --------------- | ------ | ------------------------ |
| `relationship_question`  | Server → Player | 系統   | 派發第一階段關係確認問題 |
| `relationship_confirmed` | Client → Server | 玩家   | 提交關係答案             |
| `relationship_skip`      | Client → Server | 玩家   | 跳過關係問題             |

### 旁觀者事件

| 事件名稱                     | 方向               | 觸發者 | 用途                           |
| ---------------------------- | ------------------ | ------ | ------------------------------ |
| `spectator:watch`            | Client → Server    | 旁觀者 | 直接進入旁觀看板（無需填資訊） |
| `spectator:join`             | Client → Server    | 系統   | 旁觀者加入（通過成員路徑）     |
| `spectator:joined`           | Server → All       | 系統   | 廣播旁觀者加入                 |
| `spectator:answer_submitted` | Server → Spectator | 系統   | 推送答題記錄更新               |
| `spectator:player_status`    | Server → Spectator | 系統   | 推送玩家狀態更新               |
| `spectator:tree_updated`     | Server → Spectator | 系統   | 推送族譜即時更新               |
| `spectator:sync`             | Server → Spectator | 系統   | 完整的旁觀者看板同步           |
| `spectator:redirect`         | Server → Client    | 系統   | 重導向至旁觀者模式             |

### 權限管理事件

| 事件名稱         | 方向            | 觸發者 | 用途               |
| ---------------- | --------------- | ------ | ------------------ |
| `owner_changed`  | Server → All    | 系統   | 通知房主已變更     |
| `owner_restored` | Server → Client | 系統   | 房主重連後恢復權限 |

### 錯誤與狀態事件

| 事件名稱 | 方向            | 觸發者 | 用途         |
| -------- | --------------- | ------ | ------------ |
| `error`  | Server → Client | 系統   | 傳送錯誤訊息 |

---

## 🔄 事件詳細規格

### 房間建立事件

#### `room:create` (Client → Server)

**觸發時機**：玩家在首頁填寫房間名稱與遊戲時間後點擊「建立房間」

**資料結構**：

```json
{
  "type": "room:create",
  "name": "王家族譜", // 房間名稱，2-50 字元
  "gameTime": 120 // 遊戲時長(秒)：90 | 120 | 180 或自訂
}
```

**伺服器回應**：`room:created` 事件

---

#### `room:created` (Server → Client)

**觸發時機**：房間成功建立時回傳給房主

**資料結構**：

```json
{
  "type": "room:created",
  "roomId": "ABC12345",
  "shareLink": "https://familytree.game/room/ABC12345",
  "message": "房間已建立"
}
```

**錯誤情況**：

```json
{
  "type": "error",
  "code": "ROOM_CREATE_FAILED",
  "message": "房間建立失敗，請稍後重試"
}
```

---

### 玩家加入事件

#### `member:typing` (Client → Server)

**觸發時機**：玩家開始輸入個人資訊時

**資料結構**：

```json
{
  "type": "member:typing",
  "roomId": "ABC12345"
}
```

**伺服器廣播**：`member:typing_notify` 給房間內所有其他玩家

---

#### `member:join` (Client → Server)

**觸發時機**：玩家填寫完個人資訊並點擊「加入」

**資料結構**：

```json
{
  "type": "member:join",
  "roomId": "ABC12345",
  "playerId": "uuid-string-optional", // 重連時提供
  "name": "王小明", // 2-10 字元中文
  "gender": "male", // "male" 或 "female"
  "birthday": "1990/01/15" // YYYY/MM/DD 格式
}
```

**成功加入**：伺服器回傳 `player_registered` + 廣播 `member:joined`

```json
{
  "type": "player_registered",
  "playerId": "uuid-xxxx",
  "nodeId": "uuid-yyyy",
  "message": "已成功加入房間"
}
```

**失敗情況**：

```json
{
  "type": "error",
  "code": "ROOM_NOT_FOUND",
  "message": "房間不存在"
}
```

---

#### `member:joined` (Server → All)

**觸發時機**：新玩家加入或重連成功時廣播給房間內所有人

**資料結構**：

```json
{
  "type": "member:joined",
  "playerId": "uuid-xxxx",
  "name": "王小明",
  "gender": "male",
  "isOwner": false,
  "joinedAt": 1708876800000 // 時間戳
}
```

---

### 遊戲控制事件

#### `game:start` (Client → Server)

**觸發時機**：房主點擊「開始遊戲」按鈕

**資料結構**：

```json
{
  "type": "game:start",
  "roomId": "ABC12345"
}
```

**權限檢查**：伺服器驗證發送者是否為房主

---

#### `game:started` (Server → All)

**觸發時機**：遊戲成功啟動時廣播給房間內所有人

**資料結構**：

```json
{
  "type": "game:started",
  "startTime": 1708876800000, // 伺服器時間戳
  "gameDuration": 120, // 遊戲總時長(秒)
  "phase": "relationship-scan", // 當前遊戲階段
  "message": "遊戲已開始"
}
```

---

#### `stage_completed` (Server → All)

**觸發時機**：某個遊戲階段完成，進入下一階段時

**資料結構**：

```json
{
  "type": "stage_completed",
  "stage": "relationship-scan", // 已完成的階段
  "nextStage": "in-game", // 下一個階段
  "completedAt": 1708876860000, // 完成時間
  "message": "關係確認階段已完成"
}
```

---

#### `sync:state` (Server → All)

**觸發時機**：房間狀態變更時主動推送（每 1-5 秒同步一次或事件驅動）

**資料結構**：

```json
{
  "type": "sync:state",
  "players": [
    {
      "playerId": "uuid-1",
      "name": "王大明",
      "gender": "male",
      "score": 100,
      "isOffline": false,
      "isObserver": false
    }
  ],
  "status": "relationship-scan",
  "remainingTime": 60, // 剩餘遊戲時長(秒)
  "isLocked": true, // 房間是否鎖定
  "completeness": 45 // 族譜完成度(%)
}
```

---

### 答題事件

#### `relationship_question` (Server → Player)

**觸發時機**：派發第一階段（關係確認）問題

**資料結構**：

```json
{
  "type": "relationship_question",
  "questionId": "uuid-q123",
  "askeeeId": "uuid-1", // 被詢問者ID
  "askeeeName": "王小李",
  "direction": "upward", // "upward" | "downward" | "sibling"
  "specificRelation": null, // 待使用者選擇
  "phase": "direction_select", // "direction_select" | "relation_select"
  "timeout": 30 // 倒數時限(秒)
}
```

---

#### `relationship_confirmed` (Client → Server)

**觸發時機**：玩家確認關係答案

**資料結構**：

```json
{
  "type": "relationship_confirmed",
  "questionId": "uuid-q123",
  "answer": "father", // 確認的親屬關係
  "confirmedAt": 1708876900000
}
```

---

#### `relationship_skip` (Client → Server)

**觸發時機**：玩家跳過問題

**資料結構**：

```json
{
  "type": "relationship_skip",
  "questionId": "uuid-q123",
  "reason": "dont_know" // "dont_know" | "timeout"
}
```

---

### 旁觀者事件

#### `spectator:watch` (Client → Server)

**觸發時機**：玩家直接進入旁觀者看板（無需填個人資訊）

**資料結構**：

```json
{
  "type": "spectator:watch",
  "roomId": "ABC12345",
  "visitorName": "訪客" // 匿名或給定名稱
}
```

**伺服器回應**：廣播 `spectator:joined` 並推送完整的旁觀者看板數據

---

#### `spectator:joined` (Server → All)

**觸發時機**：旁觀者成功加入時

**資料結構**：

```json
{
  "type": "spectator:joined",
  "spectatorId": "uuid-spec123",
  "name": "訪客名稱",
  "joinedAt": 1708876900000
}
```

---

#### `spectator:sync` (Server → Spectator)

**觸發時機**：旁觀者加入或進度更新時

**資料結構**：

```json
{
  "type": "spectator:sync",
  "players": [
    {
      "playerId": "uuid-1",
      "name": "王大明",
      "status": "connected",    // "connected" | "typing" | "offline"
      "score": 100,
      "contributionCount": 5
    }
  ],
  "answerHistory": [
    {
      "answerId": "uuid-a1",
      "playerId": "uuid-1",
      "playerName": "王大明",
      "question": "王小李是你的誰？",
      "answer": "brother",
      "timestamp": 1708876900000,
      "status": "confirmed"     // "confirmed" | "skipped"
    }
  ],
  "mvft": {
    "nodes": [...],
    "edges": [...]
  },
  "completeness": 45           // 族譜完成度(%)
}
```

**最多保留 50 筆答題記錄**，舊記錄循環刪除

---

#### `spectator:answer_submitted` (Server → Spectator)

**觸發時機**：玩家提交答案時實時推送

**資料結構**：

```json
{
  "type": "spectator:answer_submitted",
  "answerId": "uuid-a1",
  "playerId": "uuid-1",
  "playerName": "王大明",
  "question": "王小李是你的誰？",
  "answer": "brother",
  "timestamp": 1708876900000
}
```

---

#### `spectator:player_status` (Server → Spectator)

**觸發時機**：玩家狀態變更時實時推送

**資料結構**：

```json
{
  "type": "spectator:player_status",
  "playerId": "uuid-1",
  "name": "王大明",
  "status": "typing", // "connected" | "typing" | "offline"
  "score": 100,
  "timestamp": 1708876900000
}
```

---

#### `spectator:tree_updated` (Server → Spectator)

**觸發時機**：族譜節點更新時實時推送

**資料結構**：

```json
{
  "type": "spectator:tree_updated",
  "nodeId": "uuid-n123",
  "action": "created", // "created" | "updated" | "merged"
  "nodeName": "王阿公",
  "nodeInfo": {
    "name": "王阿公",
    "gender": "male",
    "birthday": "1940/05/20"
  },
  "completeness": 52,
  "timestamp": 1708876900000
}
```

---

### 權限事件

#### `owner_changed` (Server → All)

**觸發時機**：房主離線，權限自動轉移時

**資料結構**：

```json
{
  "type": "owner_changed",
  "oldOwnerId": "uuid-1",
  "newOwnerId": "uuid-2",
  "newOwnerName": "王小李",
  "changedAt": 1708876900000,
  "reason": "disconnection" // 轉移原因
}
```

---

#### `owner_restored` (Server → Client)

**觸發時機**：房主重連後恢復權限

**資料結構**：

```json
{
  "type": "owner_restored",
  "playerId": "uuid-1",
  "roomState": {
    // 完整的房間狀態，見 sync:state
  }
}
```

---

### 錯誤事件

#### `error` (Server → Client)

**通用錯誤訊息結構**：

```json
{
  "type": "error",
  "code": "ERROR_CODE", // 錯誤代碼
  "message": "易讀的錯誤訊息",
  "details": {} // 額外詳細信息
}
```

**常見錯誤代碼**：

- `ROOM_NOT_FOUND`：房間不存在
- `ROOM_LOCKED`：房間已鎖定，無法加入
- `INVALID_DATA`：提交資料驗證失敗
- `UNAUTHORIZED`：無權執行此操作
- `GAME_NOT_STARTED`：遊戲未啟動
- `DUPLICATE_ANSWER`：重複提交同一問題的答案
- `INTERNAL_ERROR`：伺服器內部錯誤

---

## 📊 狀態同步詳解

### 同步頻率

| 事件         | 觸發條件         | 延遲   |
| ------------ | ---------------- | ------ |
| 玩家狀態變更 | 加入、離線、重連 | 即時   |
| 房主轉移     | 房主離線         | 即時   |
| 遊戲進度更新 | 答題完成         | < 1 秒 |
| 計分更新     | 答題確認         | 1-5 秒 |
| 族譜更新     | 節點新增或修改   | < 2 秒 |
| 旁觀者進度   | 每 3-5 秒        | 3-5 秒 |

### 網路異常處理

**斷線重連期間**：

- Client 保留已傳送的訊息，重連後重新發送
- Server 不重複計算已處理的事件
- 使用 `questionId` / `answerId` 進行去重

**訊息順序保證**：

- 同一玩家的訊息按順序送達
- 不同玩家的訊息順序無保證（需 Client 端排序顯示）

---

## � 遊戲出題階段 WebSocket 事件

### 階段一：關係掃描事件

| 事件名稱                     | 發送方 | 接收方 | 資料結構                                                                | 說明                                   |
| ---------------------------- | ------ | ------ | ----------------------------------------------------------------------- | -------------------------------------- |
| `relationship_question`      | Server | Client | `{ type, questionId, targetPlayerId, question, answerOptions[] }`       | 推送關係提問（選項已按性別過濾）       |
| `relationship_answer`        | Client | Server | `{ type, questionId, playerId, answer }`                                | 回答關係                               |
| `unknown_direction_question` | Server | Client | `{ type, questionId, playerId, targetPlayerId, directions[] }`          | 追問「不知道」方向（爸爸邊、媽媽邊等） |
| `unknown_direction_answer`   | Client | Server | `{ type, questionId, playerId, direction }`                             | 回答不知道方向                         |
| `relationship_confirmed`     | Server | All    | `{ type, player1, player2, relationship, direction?, confirmed: true }` | 關係確認與方向標記，廣播給所有玩家     |

### 階段二：資料補齊事件

| 事件名稱              | 發送方 | 接收方 | 資料結構                                    | 說明                     |
| --------------------- | ------ | ------ | ------------------------------------------- | ------------------------ |
| `task_assigned`       | Server | Client | `{ type, task }`                            | 分派任務給玩家           |
| `task_lock`           | Client | Server | `{ type, taskId, playerId }`                | 玩家鎖定任務（開始作答） |
| `task_lock_broadcast` | Server | All    | `{ type, taskId, playerId }`                | 廣播任務已被鎖定         |
| `task_submit`         | Client | Server | `{ type, taskId, playerId, data }`          | 提交任務答案             |
| `task_skip`           | Client | Server | `{ type, taskId, playerId }`                | 跳過任務                 |
| `task_completed`      | Server | All    | `{ type, taskId, nodeId, filledBy, score }` | 任務完成通知             |
| `task_reassigned`     | Server | Client | `{ type, task }`                            | 任務重新分派             |

### 階段三：資料驗證事件

| 事件名稱                | 發送方 | 接收方 | 資料結構                                      | 說明             |
| ----------------------- | ------ | ------ | --------------------------------------------- | ---------------- |
| `verification_question` | Server | Client | `{ type, questionId, nodeId, content }`       | 推送驗證問題卡片 |
| `verification_answer`   | Client | Server | `{ type, questionId, playerId, answer }`      | 提交驗證答案     |
| `verification_result`   | Server | All    | `{ type, questionId, nodeId, result, score }` | 驗證結果通知     |

### 衝突解決事件

| 事件名稱              | 發送方 | 接收方              | 資料結構                                                    | 說明         |
| --------------------- | ------ | ------------------- | ----------------------------------------------------------- | ------------ |
| `conflict_detected`   | Server | Conflicting Players | `{ type, conflictId, nodeId, answer1, answer2, players[] }` | 偵測到衝突   |
| `conflict_resolution` | Client | Server              | `{ type, conflictId, playerId, chosenAnswer }`              | 衝突解決選擇 |
| `conflict_resolved`   | Server | All                 | `{ type, conflictId, finalAnswer }`                         | 衝突已解決   |

---

## �🔒 安全規則

1. **認證**：所有涉及玩家操作的事件必須驗證 `playerId`
2. **授權**：房主操作（`game:start` 等）需驗證 `isOwner` 標記
3. **速率限制**：同一玩家在 1 秒內最多提交 5 個答案
4. **資料驗證**：所有 Client 提交的資料需伺服器端驗證
5. **日誌記錄**：所有遊戲相關事件需記錄時間戳與操作者

---

**文件版本**：1.0  
**最後更新**：2026-02-26
