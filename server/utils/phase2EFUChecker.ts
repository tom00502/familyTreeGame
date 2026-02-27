/**
 * phase2EFUChecker.ts
 *
 * Phase 2 EFU (Essential Family Unit) 完成度檢測
 *
 * EFU 完成標準（三維度均需主動確認）：
 * - 向上 (upward)：所有關鍵節點的父母已確認（或為根節點）
 * - 向側 (lateral)：所有關鍵節點已被主動詢問「是否有配偶」
 *   → 回答「有」則配偶已命名；回答「沒有」則標記完成
 * - 向下 (downward)：所有關鍵節點已被主動詢問「有幾個子女」
 *   → 回答「有N個」則N個子女已命名；回答「沒有」則標記完成
 *
 * ⚠️ 重要：lateral / downward 不能僅依賴被動檢查（如 spouseIds 是否為空），
 *    必須透過「配偶詢問」/「子女詢問」任務主動確認後才能標記為 true。
 *
 * ⚠️ 階段結束條件：checkEFUCompletion 返回 true 僅代表 EFU 三維度已完成。
 *    ws.ts 中的階段轉場邏輯需同時檢查：
 *    1. EFU 完成 (checkEFUCompletion === true)
 *    2. 任務隊列為空 (taskQueue.length === 0)
 *    3. 所有已派發任務已回答 (dispatchedTasks.size === 0)
 *    三者同時滿足才可結束 Phase 2，避免某位玩家仍在答題時提前結束。
 */

import type { Room } from "./gameState";

/**
 * 檢查 Room 中所有關鍵節點（包含玩家）的 EFU 完成情況
 * 
 * @param room 房間對象
 * @returns true 若所有關鍵節點的 EFU 三維度均已完整
 */
export function checkEFUCompletion(room: Room): boolean {
  if (!room.phase2State || !room.familyTree.virtualNodes) {
    return false;
  }

  const virtualNodes = room.familyTree.virtualNodes;
  
  // 檢查所有關鍵節點（包含玩家節點）
  for (const [nodeId, vnode] of virtualNodes) {
    if (!vnode.isKeyNode) {
      continue; // 跳過非關鍵節點（終端擴張的配偶/子女不需要 EFU）
    }
    
    // 1. 非玩家的關鍵節點必須有名字
    if (!vnode.isPlayer && (!vnode.name || vnode.name === "")) {
      console.log(`[EFU] 節點 ${nodeId} 名字缺失，EFU 未完成`);
      return false;
    }
    
    // 2. 向上完整性（父、母）— 非玩家節點必須確認
    if (!vnode.efuStatus.upward) {
      if (!vnode.isPlayer) {
        console.log(`[EFU] 節點 ${nodeId} 向上(父母)未確認，EFU 未完成`);
        return false;
      }
    }
    
    // 3. 向側完整性（配偶）— 必須經過主動詢問
    //    efuStatus.lateral = false 表示尚未詢問過
    if (!vnode.efuStatus.lateral) {
      console.log(`[EFU] 節點 ${nodeId} (${vnode.name || '未命名'}) 向側(配偶)未確認，EFU 未完成`);
      return false;
    }
    
    // 4. 向下完整性（子女）— 必須經過主動詢問
    //    efuStatus.downward = false 表示尚未詢問過
    if (!vnode.efuStatus.downward) {
      console.log(`[EFU] 節點 ${nodeId} (${vnode.name || '未命名'}) 向下(子女)未確認，EFU 未完成`);
      return false;
    }
    
    // 5. 若已確認有配偶，檢查配偶是否已命名
    if (vnode.spouseIds.length > 0) {
      for (const spouseId of vnode.spouseIds) {
        const spouse = virtualNodes.get(spouseId);
        if (spouse && !spouse.isPlayer && (!spouse.name || spouse.name === "")) {
          console.log(`[EFU] 節點 ${nodeId} 的配偶 ${spouseId} 名字缺失，EFU 未完成`);
          return false;
        }
      }
    }
    
    // 6. 若已確認有子女，檢查所有子女是否已命名
    if (vnode.childrenIds.length > 0) {
      for (const childId of vnode.childrenIds) {
        const child = virtualNodes.get(childId);
        // 只檢查非玩家的子女節點（玩家節點已有名字）
        if (child && !child.isPlayer && (!child.name || child.name === "")) {
          console.log(`[EFU] 節點 ${nodeId} 的子女 ${childId} 名字缺失，EFU 未完成`);
          return false;
        }
      }
    }
  }
  
  console.log(`[EFU] 所有關鍵節點 EFU 已完成`);
  return true;
}

/**
 * 標記節點的指定 EFU 維度為完成
 */
export function markEFUDimensionComplete(
  room: Room,
  nodeId: string,
  dimension: "upward" | "lateral" | "downward"
): void {
  const vnode = room.familyTree.virtualNodes?.get(nodeId);
  if (vnode) {
    vnode.efuStatus[dimension] = true;
    vnode.updatedAt = Date.now();
  }

  const tracker = room.phase2State?.efuTrackers.get(nodeId);
  if (tracker) {
    tracker.completionStatus[dimension] = true;
  }
}

/**
 * 查詢節點的 EFU 進度
 */
export function getEFUStatus(room: Room, nodeId: string) {
  const vnode = room.familyTree.virtualNodes?.get(nodeId);
  const tracker = room.phase2State?.efuTrackers.get(nodeId);

  return {
    node: vnode,
    tracker: tracker,
    isComplete: vnode?.efuStatus.upward && vnode?.efuStatus.lateral && vnode?.efuStatus.downward,
  };
}

/**
 * 獲取 EFU 完成百分比（用於進度顯示）
 */
export function getEFUCompletionPercentage(room: Room): number {
  if (!room.familyTree.virtualNodes || room.familyTree.virtualNodes.size === 0) {
    return 0;
  }

  let completedCount = 0;
  for (const vnode of room.familyTree.virtualNodes.values()) {
    if (vnode.isKeyNode && vnode.efuStatus.upward && vnode.efuStatus.lateral && vnode.efuStatus.downward) {
      completedCount++;
    }
  }

  const keyNodeCount = Array.from(room.familyTree.virtualNodes.values()).filter(
    v => v.isKeyNode
  ).length;

  return keyNodeCount > 0 ? Math.round((completedCount / keyNodeCount) * 100) : 0;
}
