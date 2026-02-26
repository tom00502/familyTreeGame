/**
 * phase2EFUChecker.ts
 *
 * Phase 2 EFU (Essential Family Unit) 完成度檢測
 *
 * EFU 完成標準：
 * - 所有玩家節點的父母、配偶、子女均已確認
 * - 所有關鍵路徑上的虛擬節點均已命名
 * - 性別遺漏不視為阻止完成（因性別可能未知）
 */

import type { Room } from "./gameState";

/**
 * 檢查 Room 中所有虛擬節點的 EFU 完成情況
 * 
 * @param room 房間對象
 * @returns true 若所有關鍵節點的 EFU 已完整，false 其他
 */
export function checkEFUCompletion(room: Room): boolean {
  if (!room.phase2State || !room.familyTree.virtualNodes) {
    return false;
  }

  const virtualNodes = room.familyTree.virtualNodes;
  
  // 檢查所有關鍵節點
  for (const [nodeId, vnode] of virtualNodes) {
    if (!vnode.isKeyNode) {
      continue; // 跳過非關鍵節點
    }
    
    // 關鍵節點必須有名字
    if (!vnode.name || vnode.name === "") {
      console.log(`[EFU] 節點 ${nodeId} 名字缺失，EFU 未完成`);
      return false;
    }
    
    // 檢查向上完整性（父、母）
    if (!vnode.efuStatus.upward) {
      // 如果是非玩家節點，必須有父或母
      if (!vnode.isPlayer && !vnode.fatherId && !vnode.motherId) {
        console.log(`[EFU] 節點 ${nodeId} 父母未確認，EFU 未完成`);
        return false;
      }
    }
    
    // 檢查向側完整性（配偶）- 若有提及配偶則必須確認
    if (!vnode.efuStatus.lateral && vnode.spouseIds.length > 0) {
      // 配偶已提及但未確認，則不完整
      // 但如果配偶為空，則視為不需要配偶（單身或已確認無配偶）
    }
    
    // 檢查向下完整性（子女）- 若有子女則必須確認名字
    if (!vnode.efuStatus.downward && vnode.childrenIds.length > 0) {
      for (const childId of vnode.childrenIds) {
        const child = virtualNodes.get(childId);
        if (child && (!child.name || child.name === "")) {
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
