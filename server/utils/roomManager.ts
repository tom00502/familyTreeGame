// 房間管理工具函數

import type { Room, Player } from "./gameState";
import { gameState } from "./gameState";

/**
 * 處理房主離線邏輯
 */
export function handleOwnerDisconnection(room: Room, ownerId: string) {
  // 遊戲進行中不處理權限轉移
  if (room.status !== "waiting") {
    return;
  }

  // 找出連線時間最久的在線玩家
  const candidates = Array.from(room.players.values())
    .filter((p) => !p.isOffline && !p.isObserver && p.playerId !== ownerId)
    .sort((a, b) => a.joinedAt - b.joinedAt);

  if (candidates.length === 0) {
    // 房間無人，刪除房間
    console.log(`[Room] 房間 ${room.roomId} 無人，已刪除`);
    gameState.rooms.delete(room.roomId);
    return;
  }

  // 移交權限給第一位玩家
  const newOwner = candidates[0];
  if (!newOwner) return;
  
  room.controllerId = newOwner.socketId;
  room.originalOwnerId = newOwner.playerId;

  console.log(`[Room] 房主權限已轉移: ${room.roomId} -> ${newOwner.name}`);

  return {
    newOwnerId: newOwner.playerId,
    newOwnerName: newOwner.name,
  };
}

/**
 * 驗證玩家基本資料
 */
export function validatePlayerInfo(info: {
  name: string;
  gender: string;
  birthday: string;
}): { valid: boolean; error?: string } {
  if (!info.name || info.name.length < 2 || info.name.length > 10) {
    return { valid: false, error: "姓名長度需為 2-10 字元" };
  }

  if (!info.gender || !["male", "female"].includes(info.gender)) {
    return { valid: false, error: "請選擇性別" };
  }

  const birthdayDate = new Date(info.birthday);
  if (!info.birthday || isNaN(birthdayDate.getTime())) {
    return { valid: false, error: "請輸入有效的出生日期" };
  }

  return { valid: true };
}

/**
 * 檢查所有玩家是否就緒
 */
export function checkAllPlayersReady(room: Room): boolean {
  const activePlayers = Array.from(room.players.values()).filter(
    (p) => !p.isOffline && !p.isObserver
  );

  return activePlayers.length >= 2; // 至少需要 2 位玩家
}

/**
 * 清理過期房間（超過 24 小時未活動）
 */
export function cleanupOldRooms() {
  const now = Date.now();
  const ROOM_TIMEOUT = 24 * 60 * 60 * 1000; // 24 小時

  gameState.rooms.forEach((room, roomId) => {
    if (now - room.createdAt > ROOM_TIMEOUT) {
      console.log(`[Room] 清理過期房間: ${roomId}`);
      gameState.rooms.delete(roomId);
    }
  });
}

// 定期清理（每小時執行一次）
if (typeof setInterval !== "undefined") {
  setInterval(cleanupOldRooms, 60 * 60 * 1000);
}
