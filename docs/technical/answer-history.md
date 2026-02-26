# 答題歷史與進度追蹤

本文檔描述答題歷史紀錄的生命週期、維護策略、進度計算等。

---

## 📋 答題紀錄資料結構

```typescript
interface AnswerRecord {
  // 識別
  answerId: string; // 唯一記錄 ID
  questionId: string; // 對應問題 ID

  // 回答者信息
  playerId: string; // 玩家 ID
  playerName: string; // 玩家姓名

  // 答題內容
  question: string; // 完整問題文本
  answer: string | null; // 給定的答案

  // 狀態
  status: "confirmed" | "skipped";

  // 元數據
  answeredAt: number; // 答題時間戳
  index: number; // 在歷史隊列中的位置
}

interface ProgressMetrics {
  totalQuestions: number; // 總問題數
  answeredQuestions: number; // 已回答問題數
  skippedQuestions: number; // 已跳過問題數
  completionRate: number; // 完成率 (%)
  averageAnswerTime: number; // 平均答題時間(秒)
}
```

---

## 🔄 答題歷史生命週期

### 1. 建立階段

**觸發**：玩家確認或跳過問題時

```typescript
// 確認答案
if (data.type === "relationship_confirmed") {
  const answer = data.answer; // "father", "mother", "brother" 等

  const record: AnswerRecord = {
    answerId: crypto.randomUUID(),
    questionId: data.questionId,
    playerId: player.playerId,
    playerName: player.name,
    question: questionCache.get(data.questionId) || "未知問題",
    answer,
    status: "confirmed",
    answeredAt: Date.now(),
    index: room.answerHistory.length,
  };

  room.answerHistory.push(record);
}

// 跳過答案
if (data.type === "relationship_skip") {
  const record: AnswerRecord = {
    answerId: crypto.randomUUID(),
    questionId: data.questionId,
    playerId: player.playerId,
    playerName: player.name,
    question: questionCache.get(data.questionId) || "未知問題",
    answer: null,
    status: "skipped",
    answeredAt: Date.now(),
    index: room.answerHistory.length,
  };

  room.answerHistory.push(record);
}
```

### 2. 廣播階段

**推送給旁觀者**：

```typescript
// 新增記錄後，即時推送給旁觀者
broadcastToSpectators(roomId, {
  type: "spectator:answer_submitted",
  answerId: record.answerId,
  playerId: record.playerId,
  playerName: record.playerName,
  question: record.question,
  answer: record.answer,
  status: record.status,
  timestamp: record.answeredAt,
});
```

### 3. 維護階段

**循環管理：最多 50 筆**

```typescript
const MAX_HISTORY_SIZE = 50;

function manageAnswerHistory(room: Room) {
  while (room.answerHistory.length > MAX_HISTORY_SIZE) {
    const removed = room.answerHistory.shift();

    logger.debug(`答題歷史溢出，移除最舊記錄 (${removed?.answerId})`);
  }

  // 重新計算索引
  room.answerHistory.forEach((record, idx) => {
    record.index = idx;
  });
}
```

**為什麼是 50 筆**：

- 讓旁觀者看到最近的遊戲進展
- 控制單連線的資料傳輸量（每筆約 200-300 bytes）
- 快速查詢與更新（O(1) append, O(1) shift）
- 防止記憶體無限增長

### 4. 查詢階段

**檢索特定範圍的記錄**：

```typescript
function getAnswerHistoryFor(
  room: Room,
  playerId?: string,
  limit: number = 50,
): AnswerRecord[] {
  let history = room.answerHistory || [];

  // 按玩家篩選
  if (playerId) {
    history = history.filter((r) => r.playerId === playerId);
  }

  // 返回最後 N 筆（新到舊）
  return history.slice(-limit);
}

function getAnswersByQuestion(room: Room, questionId: string): AnswerRecord[] {
  return (room.answerHistory || []).filter((r) => r.questionId === questionId);
}
```

---

## 📊 進度計算

### 完成度計算

```typescript
function calculateProgressMetrics(room: Room): ProgressMetrics {
  const history = room.answerHistory || [];

  const totalQuestions = room.taskQueue.length + history.length;
  const answeredQuestions = history.filter(
    (r) => r.status === "confirmed",
  ).length;
  const skippedQuestions = history.filter((r) => r.status === "skipped").length;

  const completionRate =
    totalQuestions > 0
      ? Math.round(
          ((answeredQuestions + skippedQuestions) / totalQuestions) * 100,
        )
      : 0;

  // 計算平均答題時間
  let totalTime = 0;
  for (let i = 1; i < history.length; i++) {
    const timeDiff = history[i].answeredAt - history[i - 1].answeredAt;
    totalTime += timeDiff;
  }
  const averageAnswerTime =
    history.length > 1
      ? Math.round(totalTime / (history.length - 1) / 1000)
      : 0;

  return {
    totalQuestions,
    answeredQuestions,
    skippedQuestions,
    completionRate,
    averageAnswerTime,
  };
}
```

### 玩家貢獻統計

```typescript
function getPlayerContributions(
  room: Room,
  playerId: string,
): {
  totalAnswers: number;
  confirmCount: number;
  skipCount: number;
  contributionRate: number;
} {
  const playerAnswers = (room.answerHistory || []).filter(
    (r) => r.playerId === playerId,
  );

  const confirmCount = playerAnswers.filter(
    (r) => r.status === "confirmed",
  ).length;
  const skipCount = playerAnswers.filter((r) => r.status === "skipped").length;

  const totalAnswers = (room.answerHistory || []).length;
  const contributionRate =
    totalAnswers > 0
      ? Math.round((playerAnswers.length / totalAnswers) * 100)
      : 0;

  return {
    totalAnswers: playerAnswers.length,
    confirmCount,
    skipCount,
    contributionRate,
  };
}
```

---

## 🔄 同步策略

### 初次連線同步

```typescript
// 新玩家或旁觀者加入時
const recentHistory = room.answerHistory
  ? room.answerHistory.slice(-50) // 最多 50 筆
  : [];

send({
  type: "spectator:sync",
  answerHistory: recentHistory.map((r) => ({
    answerId: r.answerId,
    playerId: r.playerId,
    playerName: r.playerName,
    question: r.question,
    answer: r.answer,
    status: r.status,
    timestamp: r.answeredAt,
  })),
  progressMetrics: calculateProgressMetrics(room),
});
```

### 持續更新同步

```typescript
// 每個新答題記錄建立後
broadcastToSpectators(roomId, {
  type: "spectator:answer_submitted",
  answerId: record.answerId,
  playerId: record.playerId,
  playerName: record.playerName,
  question: record.question,
  answer: record.answer,
  timestamp: record.answeredAt,
});

// 定期推送進度指標（每 10 秒）
setInterval(() => {
  gameState.rooms.forEach((room) => {
    const metrics = calculateProgressMetrics(room);

    broadcastToSpectators(room.roomId, {
      type: "spectator:progress_update",
      metrics,
      timestamp: Date.now(),
    });
  });
}, 10 * 1000);
```

---

## 🧹 清理策略

### 遊戲結束時保存

```typescript
function finalizeGameHistory(room: Room) {
  // 計算最終統計
  const finalMetrics = calculateProgressMetrics(room);
  const playerStats = Array.from(room.players.values()).map((p) => {
    const contrib = getPlayerContributions(room, p.playerId);
    return {
      playerId: p.playerId,
      name: p.name,
      ...contrib,
      finalScore: p.score,
    };
  });

  // 可選：歸檔至資料庫
  if (dbConnection) {
    db.saveGameResult({
      roomId: room.roomId,
      startTime: room.gameStartTime,
      endTime: room.gameEndTime,
      duration: room.gameDuration,
      finalMetrics,
      playerStats,
      answerHistory: room.answerHistory,
    });
  }

  // 清空記憶體中的歷史（若記憶體緊張）
  room.answerHistory = [];
}
```

---

**文件版本**：1.0  
**最後更新**：2026-02-26
