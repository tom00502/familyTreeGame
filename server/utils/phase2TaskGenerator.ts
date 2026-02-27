/**
 * phase2TaskGenerator.ts
 *
 * Phase 2 資料填充: 虛擬節點實例化 & 任務生成
 *
 * 流程：
 *   Phase 1 結束（relationships 收集完畢）
 *     → instantiateVirtualNodes() → virtualNodes Map
 *     → generatePhase2Tasks() → taskQueue 列表
 *     → attachTasksToPlayers() → dispatchedTasks Map
 */

import type {
  Room,
  Player,
  Phase2Task,
  VirtualNode,
  RelationshipRecord,
  EdgeType,
  Gender,
  TaskPriority,
  EfuDimension,
  EFUTracker,
} from "./gameState";
import { titleToPath } from "./mvftBuilder";

// ──────────────────────────────────────────────
// 虛擬節點實例化
// ──────────────────────────────────────────────

/**
 * 根據 Phase 1 的 relationships 記錄，實例化所有虛擬節點。
 * 使用 Get-or-Create 邏輯，確保不重複建立。
 *
 * @param relationships 玩家在 Phase 1 提交的關係紀錄
 * @param playerMap 所有玩家 Map
 * @returns virtualNodes Map (nodeId → VirtualNode)
 */
export function instantiateVirtualNodes(
  relationships: RelationshipRecord[],
  playerMap: Map<string, Player>
): Map<string, VirtualNode> {
  const virtualNodes = new Map<string, VirtualNode>();
  const createdNodeIds = new Set<string>();

  /**
   * 根據路徑遍歷並創建虛擬節點
   * 注意：最後一條邊通往目標玩家，不應建立虛擬節點
   */
  function walkPath(
    edges: EdgeType[],
    startPlayerId: string,
    objectPlayerId: string,
    roleLabels: string[]
  ) {
    let currentNodeId = startPlayerId; // 從玩家節點開始

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const isLastEdge = i === edges.length - 1;

      // 最後一條邊的目的地是目標玩家（不是虛擬節點）
      const nextNodeId = isLastEdge
        ? objectPlayerId
        : generateNodeId(currentNodeId, edge);

      // 只為中間邊建立虛擬節點（最後一步是已知的玩家節點）
      if (!isLastEdge && !virtualNodes.has(nextNodeId) && !createdNodeIds.has(nextNodeId)) {
        const nodeLabel = roleLabels[i] || edge;
        const nodeGender = inferGenderFromEdge(edge);

        const vnode: VirtualNode = {
          id: nextNodeId,
          name: "",
          gender: nodeGender,
          isPlayer: false,
          isKeyNode: true,
          expansionType: "FULL",
          efuStatus: {
            upward: nodeGender === "unknown" ? false : true,
            lateral: false,
            downward: false,
          },
          fatherId: undefined,
          motherId: undefined,
          spouseIds: [],
          childrenIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        // 建立父子關係
        if (edge.startsWith("P")) {
          // 往上移動：新節點是 currentNode 的父/母
          vnode.childrenIds.push(currentNodeId);
        } else if (edge.startsWith("C")) {
          // 往下移動：currentNode 是新節點的父/母
          // 設置子節點的 fatherId/motherId
          const parentVNode = virtualNodes.get(currentNodeId);
          const parentGender = parentVNode?.gender 
            ?? (playerMap ? Array.from(playerMap.values()).find(p => p.nodeId === currentNodeId)?.gender : undefined);
          if (parentGender === "male") {
            vnode.fatherId = currentNodeId;
          } else if (parentGender === "female") {
            vnode.motherId = currentNodeId;
          }
          // 更新父節點的 childrenIds
          if (parentVNode && !parentVNode.childrenIds.includes(nextNodeId)) {
            parentVNode.childrenIds.push(nextNodeId);
          }
        } else if (edge === "S") {
          // 配偶關係
          vnode.spouseIds.push(currentNodeId);
        }

        virtualNodes.set(nextNodeId, vnode);
        createdNodeIds.add(nextNodeId);
      } else if (!isLastEdge && virtualNodes.has(nextNodeId)) {
        // 虛擬節點已存在，但需要補充父子關係
        const existingNode = virtualNodes.get(nextNodeId)!;
        if (edge.startsWith("P") && !existingNode.childrenIds.includes(currentNodeId)) {
          existingNode.childrenIds.push(currentNodeId);
        } else if (edge.startsWith("C")) {
          // 往下移動：currentNode 是父/母，existingNode 是子女
          const parentVNode = virtualNodes.get(currentNodeId);
          const parentGender = parentVNode?.gender
            ?? (playerMap ? Array.from(playerMap.values()).find(p => p.nodeId === currentNodeId)?.gender : undefined);
          if (parentGender === "male" && !existingNode.fatherId) {
            existingNode.fatherId = currentNodeId;
          } else if (parentGender === "female" && !existingNode.motherId) {
            existingNode.motherId = currentNodeId;
          }
          if (parentVNode && !parentVNode.childrenIds.includes(nextNodeId)) {
            parentVNode.childrenIds.push(nextNodeId);
          }
        } else if (edge === "S" && !existingNode.spouseIds.includes(currentNodeId)) {
          existingNode.spouseIds.push(currentNodeId);
        }
      }

      // 最後一條邊：建立中間虛擬節點與目標玩家之間的關係
      if (isLastEdge) {
        if (edge.startsWith("P")) {
          // 目標玩家是 currentNode 的父/母 → 不需要額外操作（玩家節點由另一邏輯管理）
        } else if (edge.startsWith("C")) {
          // currentNode 是父/母，目標玩家是子女
          const parentNode = virtualNodes.get(currentNodeId);
          if (parentNode && !parentNode.childrenIds.includes(objectPlayerId)) {
            parentNode.childrenIds.push(objectPlayerId);
          }
        } else if (edge === "S") {
          const node = virtualNodes.get(currentNodeId);
          if (node && !node.spouseIds.includes(objectPlayerId)) {
            node.spouseIds.push(objectPlayerId);
          }
        }
      }

      currentNodeId = nextNodeId;
    }
  }

  // 遍歷所有 relationships，為每個玩家實例化路徑
  // 使用 subjectNodeId/objectNodeId（與 buildSkeletonMvft 一致）確保 ID 體系統一
  for (const rel of relationships) {
    if (!rel.path || rel.path.length === 0) continue;
    walkPath(rel.path, rel.subjectNodeId, rel.objectNodeId, rel.roleLabels || []);
  }

  // 確保所有玩家本身也是虛擬節點表中（以 nodeId 為 key，與 MVFT 一致）
  for (const [playerId, player] of playerMap) {
    if (!virtualNodes.has(player.nodeId)) {
      // 檢查是否已有配偶/子女邊（Phase 1 可能已建立）
      // 配偶：檢查是否有明確的配偶邊從此玩家出發（路徑第一步是 S）
      const hasSpouseFromPhase1 = relationships.some(
        r => r.subjectNodeId === player.nodeId && r.path?.[0] === 'S'
      ) || relationships.some(
        r => r.objectNodeId === player.nodeId && r.path?.[r.path.length - 1] === 'S'
      );
      // 子女：檢查是否有明確的子女邊從此玩家出發（路徑第一步是 C_m, C_f, C_any）
      const hasChildrenFromPhase1 = relationships.some(
        r => r.subjectNodeId === player.nodeId && r.path?.[0]?.startsWith('C')
      ) || relationships.some(
        r => r.objectNodeId === player.nodeId && r.path?.[r.path.length - 1]?.startsWith('C')
      );

      virtualNodes.set(player.nodeId, {
        id: player.nodeId,
        name: player.name,
        gender: player.gender,
        isPlayer: true,
        playerId: playerId,
        isKeyNode: true,
        expansionType: "FULL",
        efuStatus: {
          upward: true, // 玩家本身的父母在 Phase 1 建立路徑時已處理
          lateral: hasSpouseFromPhase1, // 只有從 Phase1 已知有配偶邊才為 true
          downward: hasChildrenFromPhase1, // 只有從 Phase1 已知有子女邊才為 true
        },
        spouseIds: [],
        childrenIds: [],
        createdAt: player.joinedAt,
        updatedAt: Date.now(),
      });
    } else {
      // 玩家節點已存在（可能由其他玩家的關係路徑建立），確保 lateral/downward 正確
      const existingNode = virtualNodes.get(player.nodeId)!;
      // 如果沒有已知配偶，lateral 應該為 false（需要主動詢問）
      if (existingNode.spouseIds.length === 0) {
        existingNode.efuStatus.lateral = false;
      }
      // 如果沒有已知子女，downward 應該為 false（需要主動詢問）
      if (existingNode.childrenIds.length === 0) {
        existingNode.efuStatus.downward = false;
      }
    }
  }

  // 虛擬節點去重：合併代表同一人的節點（同性別、同一子節點的父/母）
  deduplicateVirtualNodes(virtualNodes);

  return virtualNodes;
}

// ──────────────────────────────────────────────
// 虛擬節點去重
// ──────────────────────────────────────────────

/**
 * 合併代表同一人的虛擬節點。
 *
 * 偵測條件：若同一子節點存在多個同性別的虛擬父母節點，
 * 代表這些節點實為同一人（例如：兄弟各自描述的「父親」）。
 *
 * 採用迭代收斂策略（與 mvftBuilder.deduplicateParentNodes 相同），
 * 合併後可能產生新的重複，需反覆執行直到不動點。
 */
function deduplicateVirtualNodes(
  virtualNodes: Map<string, VirtualNode>
): void {
  const MAX_PASSES = 20;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // 建立 childId → 同性別父母虛擬節點 ID 列表
    const maleParentsOf = new Map<string, string[]>();
    const femaleParentsOf = new Map<string, string[]>();

    for (const [nodeId, vnode] of virtualNodes) {
      if (vnode.isPlayer) continue;
      for (const childId of vnode.childrenIds) {
        const map = vnode.gender === "female" ? femaleParentsOf : maleParentsOf;
        if (!map.has(childId)) map.set(childId, []);
        map.get(childId)!.push(nodeId);
      }
    }

    let merged = false;

    const mergeGroup = (parentMap: Map<string, string[]>) => {
      for (const [, parentIds] of parentMap) {
        if (parentIds.length < 2) continue;

        const keepId = parentIds[0]!;
        const keepNode = virtualNodes.get(keepId);
        if (!keepNode) continue;

        for (let i = 1; i < parentIds.length; i++) {
          const oldId = parentIds[i]!;
          const oldNode = virtualNodes.get(oldId);
          if (!oldNode) continue;

          // 合併屬性到保留節點
          for (const childId of oldNode.childrenIds) {
            if (!keepNode.childrenIds.includes(childId)) {
              keepNode.childrenIds.push(childId);
            }
          }
          for (const spouseId of oldNode.spouseIds) {
            if (!keepNode.spouseIds.includes(spouseId)) {
              keepNode.spouseIds.push(spouseId);
            }
          }
          if (oldNode.name && !keepNode.name) {
            keepNode.name = oldNode.name;
          }
          if (oldNode.fatherId && !keepNode.fatherId) {
            keepNode.fatherId = oldNode.fatherId;
          }
          if (oldNode.motherId && !keepNode.motherId) {
            keepNode.motherId = oldNode.motherId;
          }

          // 更新所有其他節點中對 oldId 的引用
          for (const [, vnode] of virtualNodes) {
            if (vnode.fatherId === oldId) vnode.fatherId = keepId;
            if (vnode.motherId === oldId) vnode.motherId = keepId;
            vnode.childrenIds = vnode.childrenIds.map(id => id === oldId ? keepId : id);
            vnode.spouseIds = vnode.spouseIds.map(id => id === oldId ? keepId : id);
            // 去除自引用
            vnode.childrenIds = vnode.childrenIds.filter(id => id !== vnode.id);
            vnode.spouseIds = vnode.spouseIds.filter(id => id !== vnode.id);
          }

          virtualNodes.delete(oldId);
          merged = true;
        }
      }
    };

    mergeGroup(maleParentsOf);
    mergeGroup(femaleParentsOf);

    if (!merged) break;
    console.log(`[Phase 2 Dedup] Pass ${pass + 1}: 合併了重複的虛擬節點`);
  }
}

/**
 * 邊類型到中文稱謂的映射
 * 根據路徑邊序列產生人類可讀的親屬稱謂
 */
const EDGE_PATH_TO_LABEL: Record<string, string> = {
  // 一代
  "P_f": "爸爸",
  "P_m": "媽媽",
  "P_any": "父/母",
  "C_m": "兒子",
  "C_f": "女兒",
  "C_any": "子女",
  "S": "配偶",
  // 二代 (父系)
  "P_f_P_f": "祖父",
  "P_f_P_m": "祖母",
  // 二代 (母系)
  "P_m_P_f": "外公",
  "P_m_P_m": "外婆",
  // 三代 (父系)
  "P_f_P_f_P_f": "曾祖父",
  "P_f_P_f_P_m": "曾祖母",
  "P_f_P_m_P_f": "曾外祖父（父側）",
  "P_f_P_m_P_m": "曾外祖母（父側）",
  // 三代 (母系)
  "P_m_P_f_P_f": "曾外祖父（母側）",
  "P_m_P_f_P_m": "曾外祖母（母側）",
  "P_m_P_m_P_f": "曾外祖父",
  "P_m_P_m_P_m": "曾外祖母",
  // 兄弟姊妹
  "P_f_C_m": "兄弟",
  "P_f_C_f": "姊妹",
  "P_m_C_m": "兄弟",
  "P_m_C_f": "姊妹",
  // 叔伯姑姨
  "P_f_P_f_C_m": "叔伯",
  "P_f_P_f_C_f": "姑姑",
  "P_f_P_m_C_m": "叔伯",
  "P_f_P_m_C_f": "姑姑",
  "P_m_P_f_C_m": "舅舅",
  "P_m_P_f_C_f": "阿姨",
  "P_m_P_m_C_m": "舅舅",
  "P_m_P_m_C_f": "阿姨",
  // 堂表兄弟姊妹
  "P_f_P_f_C_m_C_m": "堂兄弟",
  "P_f_P_f_C_m_C_f": "堂姊妹",
  "P_f_P_f_C_f_C_m": "表兄弟",
  "P_f_P_f_C_f_C_f": "表姊妹",
  "P_m_P_f_C_m_C_m": "表兄弟",
  "P_m_P_f_C_m_C_f": "表姊妹",
  "P_m_P_f_C_f_C_m": "表兄弟",
  "P_m_P_f_C_f_C_f": "表姊妹",
};

/**
 * 從節點 ID 解析出起始 UUID（nodeId）和邊序列
 * 節點 ID 格式：{nodeId}_{edge1}_{edge2}...
 * 例如：6415d450-ab52-4916-a4a3-e5b036d3adfb_P_f → nodeId + P_f
 */
function parseNodeIdComponents(nodeId: string): { playerId: string; edgePath: string[] } | null {
  // UUID 格式: 8-4-4-4-12 字元
  const uuidRegex = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const match = nodeId.match(uuidRegex);
  
  if (!match) {
    return null;
  }
  
  const playerId = match[1];
  const remainder = nodeId.slice(playerId.length);
  
  if (!remainder || remainder === "") {
    return { playerId, edgePath: [] };
  }
  
  // 移除開頭的 _
  const edgeStr = remainder.startsWith("_") ? remainder.slice(1) : remainder;
  
  if (!edgeStr) {
    return { playerId, edgePath: [] };
  }
  
  // 解析邊序列：P_f, P_m, C_m, C_f, S
  const edgePath: string[] = [];
  let remaining = edgeStr;
  
  while (remaining.length > 0) {
    // 嘗試匹配 P_f, P_m, C_m, C_f, S
    const edgeMatch = remaining.match(/^(P_f|P_m|P_any|C_m|C_f|C_any|S)(?:_|$)/);
    if (edgeMatch) {
      edgePath.push(edgeMatch[1]);
      remaining = remaining.slice(edgeMatch[1].length);
      if (remaining.startsWith("_")) {
        remaining = remaining.slice(1);
      }
    } else {
      break;
    }
  }
  
  return { playerId, edgePath };
}

/**
 * 將節點 ID 轉換為人類可讀的標籤
 * 
 * **路徑簡化邏輯**：
 * 若節點 ID 為 `UUID_P_f_P_f_C_m`，完整路徑為「陳昱宏的爸爸的爸爸的兒子」。
 * 但如果中間節點 `UUID_P_f_P_f`（=陳昱宏的祖父）已有名字「王志遠」，
 * 則應簡化為「王志遠的兒子」而非展開完整路徑。
 * 
 * 演算法：從路徑最長的中間節點開始檢查，找到第一個已命名的節點作為起點，
 * 只展開從該節點到目標節點的剩餘路徑。
 * 
 * @param nodeId 節點 ID
 * @param playerMap 玩家映射表
 * @param virtualNodes 虛擬節點 Map（用於查找已命名的中間節點）
 * @returns 人類可讀的標籤，如「王志遠的兒子」
 */
function parseNodeIdToHumanLabel(
  nodeId: string,
  playerMap: Map<string, Player>,
  virtualNodes?: Map<string, VirtualNode>
): string {
  const parsed = parseNodeIdComponents(nodeId);
  
  if (!parsed) {
    return nodeId; // 無法解析時返回原始 ID
  }
  
  const { playerId: prefixId, edgePath } = parsed;
  // prefixId 是節點 ID 的 UUID 前綴，可能是 player.nodeId
  // 先嘗試用 playerId 查找，再用 nodeId 查找
  let player = playerMap.get(prefixId);
  if (!player) {
    player = Array.from(playerMap.values()).find(p => p.nodeId === prefixId);
  }
  const playerName = player?.name || "玩家";
  
  if (edgePath.length === 0) {
    return playerName; // 玩家本人
  }
  
  // ── 路徑簡化：從最長的中間節點往回找已命名的節點 ──
  if (virtualNodes && edgePath.length > 1) {
    // 從 edgePath.length-1 倒退到 1，檢查中間節點是否已有名字
    for (let i = edgePath.length - 1; i >= 1; i--) {
      const intermediateEdges = edgePath.slice(0, i);
      const intermediateNodeId = `${prefixId}_${intermediateEdges.join("_")}`;
      const intermediateNode = virtualNodes.get(intermediateNodeId);
      
      if (intermediateNode && intermediateNode.name && intermediateNode.name !== '') {
        // 找到已命名的中間節點！只展開剩餘路徑
        const remainingEdges = edgePath.slice(i);
        const remainingPath = remainingEdges.join("_");
        const remainingLabel = EDGE_PATH_TO_LABEL[remainingPath];
        
        if (remainingLabel) {
          return `${intermediateNode.name}的${remainingLabel}`;
        }
        
        // 逐級組合剩餘路徑
        let currentLabel = intermediateNode.name;
        for (const edge of remainingEdges) {
          const singleEdgeLabel = EDGE_PATH_TO_LABEL[edge];
          if (!singleEdgeLabel) {
            console.warn(`[Phase 2 Label] 未知邊類型："${edge}"（路徑簡化殘餘），完整路徑=[${edgePath.join(', ')}]，節點ID=${nodeId}`);
          }
          currentLabel = `${currentLabel}的${singleEdgeLabel || "親屬"}`;
        }
        return currentLabel;
      }
    }
  }
  
  // ── 無法簡化：嘗試完整路徑的標籤 ──
  const fullPath = edgePath.join("_");
  const label = EDGE_PATH_TO_LABEL[fullPath];
  
  if (label) {
    return `${playerName}的${label}`;
  }
  
  // 如果沒有完整路徑匹配，逐級解析
  let currentLabel = playerName;
  for (const edge of edgePath) {
    const singleEdgeLabel = EDGE_PATH_TO_LABEL[edge];
    if (singleEdgeLabel) {
      currentLabel = `${currentLabel}的${singleEdgeLabel}`;
    } else {
      // 未知邊類型 → 記錄系統 log 以便追蹤
      console.warn(`[Phase 2 Label] 未知邊類型："${edge}"，完整路徑=[${edgePath.join(', ')}]，節點ID=${nodeId}，起始玩家=${playerName}`);
      currentLabel = `${currentLabel}的親屬`;
    }
  }
  
  return currentLabel;
}

/**
 * 獲取節點的稱謂標籤（不含玩家名稱前綴）
 */
function getRelationshipLabel(edgePath: string[]): string {
  if (edgePath.length === 0) {
    return "本人";
  }
  
  const fullPath = edgePath.join("_");
  const label = EDGE_PATH_TO_LABEL[fullPath];
  
  if (label) {
    return label;
  }
  
  // 逐級組合
  let result = "";
  for (const edge of edgePath) {
    const singleEdgeLabel = EDGE_PATH_TO_LABEL[edge];
    if (!singleEdgeLabel) {
      console.warn(`[Phase 2 Label] getRelationshipLabel 未知邊類型："${edge}"，完整路徑=[${edgePath.join(', ')}]`);
    }
    result = result ? `${result}的${singleEdgeLabel || "親屬"}` : (singleEdgeLabel || "親屬");
  }
  
  return result || "親屬";
}

// ──────────────────────────────────────────────
// 任務生成
// ──────────────────────────────────────────────

/**
 * 根據虛擬節點狀態，生成 Phase 2 任務隊列。
 * 遍歷所有虛擬節點，檢查缺失的屬性，分配優先級。
 *
 * @param room 房間對象
 * @param virtualNodes 虛擬節點 Map
 * @returns sorted tasks (L1-L6 按優先級排列)
 */
export function generatePhase2Tasks(
  room: Room,
  virtualNodes: Map<string, VirtualNode>
): Phase2Task[] {
  const tasks: Phase2Task[] = [];
  let taskCounter = 0;

  const playerIds = Array.from(room.players.keys());
  if (playerIds.length === 0) return [];

  /**
   * 判斷節點是否在關鍵路徑上
   * 關鍵路徑 = 連接所有玩家節點的最短路徑
   */
  function isKeyPathNode(nodeId: string): boolean {
    // TODO: 實現 BFS 來找出關鍵路徑節點
    // 對於現在，簡單地視所有虛擬節點為關鍵路徑節點
    return virtualNodes.get(nodeId)?.isKeyNode ?? false;
  }

  /**
   * 為節點分配優先級
   * L1-L3：關鍵路徑上的節點（必需屬性：名字、性別、父母、配偶、子女）
   * L4-L6：終端節點或可選屬性（生日、排序確認）
   */
  function getNodesToProcess(): Array<{
    nodeId: string;
    priority: "critical" | "optional";
  }> {
    const result: Array<{
      nodeId: string;
      priority: "critical" | "optional";
    }> = [];

    for (const [nodeId, vnode] of virtualNodes) {
      // 玩家節點也需要處理（用於 lateral/downward inquiry）
      // 但不需要命名和屬性填充（那些信息已知）
      result.push({
        nodeId,
        priority: isKeyPathNode(nodeId) ? "critical" : "optional",
      });
    }

    return result;
  }

  const nodesToProcess = getNodesToProcess();
  const playerMap = room.players;

  // 第一部分：名字填充任務（非玩家虛擬節點）
  for (const { nodeId, priority } of nodesToProcess) {
    const vnode = virtualNodes.get(nodeId)!;
    if (vnode.isPlayer) continue; // 玩家的名字已知
    if (!vnode.name || vnode.name === "") {
      const task = createNodeNamingTask(
        vnode,
        priority === "critical" ? "L1" : "L4",
        taskCounter++,
        playerMap,
        virtualNodes
      );
      tasks.push(task);
    }
  }

  // 第二部分：★ 向上追溯任務（確認父母）— 優先級 L1，向上填充優先於向下
  // 設計原則：優先問「誰的爸爸/媽媽是什麼名字」而非「誰的兒子是什麼名字」
  // 因為從上而下的提問（如「XXX的兒子叫什麼」）不精確，可能有多個子女造成誤判
  for (const { nodeId, priority } of nodesToProcess) {
    const vnode = virtualNodes.get(nodeId)!;
    if (vnode.isPlayer) continue; // 玩家的父母在 Phase 1 已處理
    if (!vnode.efuStatus.upward && priority === "critical") {
      if (!vnode.fatherId) {
        const task = createUpwardTracingTask(
          vnode,
          "father",
          "L1",
          taskCounter++,
          playerMap,
          virtualNodes
        );
        tasks.push(task);
      }
      if (!vnode.motherId) {
        const task = createUpwardTracingTask(
          vnode,
          "mother",
          "L1",
          taskCounter++,
          playerMap,
          virtualNodes
        );
        tasks.push(task);
      }
    }
  }

  // 第三部分：性別填充任務（非玩家節點）
  // 規則 3：資訊去重 — 若性別已從 EdgeType 推斷得知，不生成性別任務
  for (const { nodeId, priority } of nodesToProcess) {
    const vnode = virtualNodes.get(nodeId)!;
    if (vnode.isPlayer) continue; // 玩家的性別已知
    if (vnode.gender === "unknown") {
      const task = createAttributeFillingTask(
        vnode,
        "gender",
        priority === "critical" ? "L2" : "L4",
        taskCounter++,
        playerMap,
        virtualNodes
      );
      tasks.push(task);
    }
    // else: 性別已從邊類型推斷 (P_f=male, P_m=female, C_m=male, C_f=female)，跳過
  }

  // 第五部分：配偶詢問任務（lateral inquiry — 包含玩家節點）
  for (const { nodeId, priority } of nodesToProcess) {
    const vnode = virtualNodes.get(nodeId)!;
    if (!vnode.efuStatus.lateral && priority === "critical") {
      // 規則 3 去重：如果已知有配偶（spouseIds 有值），跳過詢問
      if (vnode.spouseIds.length > 0) {
        vnode.efuStatus.lateral = true;
        continue;
      }
      const task = createLateralInquiryTask(
        vnode,
        "L2",
        taskCounter++,
        playerMap,
        virtualNodes
      );
      tasks.push(task);
    }
  }

  // 第六部分：子女詢問任務（downward inquiry — 包含玩家節點）
  // ★ 注意：向下詢問（「XXX有幾個小孩」）排在向上追溯之後
  // 因為從上而下的提問不精確，可能有多個子女。先確認向上關係再處理向下
  for (const { nodeId, priority } of nodesToProcess) {
    const vnode = virtualNodes.get(nodeId)!;
    if (!vnode.efuStatus.downward && priority === "critical") {
      // 規則 3 去重：如果已知有子女（childrenIds 有值），仍要問是否還有其他子女
      const knownChildrenCount = vnode.childrenIds.length;
      const knownChildrenNames = vnode.childrenIds
        .map(id => virtualNodes.get(id)?.name || '')
        .filter(n => n !== '');
      
      const task = createDownwardInquiryTask(
        vnode,
        "L2",
        taskCounter++,
        playerMap,
        knownChildrenCount,
        knownChildrenNames,
        virtualNodes
      );
      tasks.push(task);
    }
  }

  // 第七部分：生日填充任務（可選）
  // 規則 3：資訊去重 — 若虛擬節點已有生日，不生成生日任務
  for (const { nodeId } of nodesToProcess) {
    const vnode = virtualNodes.get(nodeId)!;
    if (vnode.isPlayer) continue; // 玩家的生日已知
    if (!vnode.birthday) {
      const task = createAttributeFillingTask(
        vnode,
        "birthday",
        "L5",
        taskCounter++,
        playerMap,
        virtualNodes
      );
      tasks.push(task);
    }
  }

  return tasks;
}

/**
 * 規則 5：當節點獲得姓名後，更新所有引用該節點的待派任務標籤
 * 主詞從「XXX的爸爸」變為「王大華」
 * 
 * 同時，更新所有以該節點為路徑中間節點的任務標籤，
 * 例如原本「陳昱宏的爸爸的爸爸的兒子」→ 如果「陳昱宏的爸爸的爸爸」(祖父) 已命名為「王志遠」，
 * 則更新為「王志遠的兒子」。
 */
export function updateTaskLabelsAfterNaming(
  nodeId: string,
  newName: string,
  taskQueue: Phase2Task[],
  dispatchedTasks: Map<string, Phase2Task>,
  playerMap?: Map<string, Player>,
  virtualNodes?: Map<string, VirtualNode>
): void {
  const updateLabel = (task: Phase2Task) => {
    // 直接匹配：任務目標就是這個節點
    if ((task as any).targetNodeId === nodeId) {
      if ('targetNodeName' in task) {
        (task as any).targetNodeName = newName;
      }
      if ('targetNodeLabel' in task) {
        (task as any).targetNodeLabel = newName;
      }
    }
    // 間接匹配：任務目標節點的路徑包含此節點作為中間節點
    // 重新生成簡化標籤
    else if (playerMap && virtualNodes && (task as any).targetNodeId) {
      const targetId = (task as any).targetNodeId as string;
      // 檢查 targetId 是否包含 nodeId 作為前綴（表示路徑經過此節點）
      if (targetId.startsWith(nodeId + '_') || targetId.includes('_' + nodeId.split('_').slice(-1)[0])) {
        const simplified = parseNodeIdToHumanLabel(targetId, playerMap, virtualNodes);
        if ('targetNodeName' in task && !(task as any).targetNodeName?.match(/^[^\u7684]+$/)) {
          // 只更新仍然是路徑描述的標籤（非純名字）
          (task as any).targetNodeName = simplified;
        }
        if ('targetNodeLabel' in task && (task as any).targetNodeLabel?.includes('的')) {
          (task as any).targetNodeLabel = simplified;
        }
      }
    }
    
    // ★ 兄弟姊妹消歧義更新：若此任務是 node-naming 且有 knownSiblingNames，
    // 檢查剛命名的節點是否為其兄弟姊妹，若是則加入 knownSiblingNames
    if (task.type === 'node-naming' && virtualNodes && (task as any).targetNodeId !== nodeId) {
      const taskTargetId = (task as any).targetNodeId as string;
      const taskTargetNode = virtualNodes.get(taskTargetId);
      const namedNode = virtualNodes.get(nodeId);
      
      if (taskTargetNode && namedNode) {
        // 檢查是否同父或同母（兄弟姊妹）
        const isSibling = (
          (taskTargetNode.fatherId && taskTargetNode.fatherId === namedNode.fatherId) ||
          (taskTargetNode.motherId && taskTargetNode.motherId === namedNode.motherId)
        );
        
        if (isSibling && newName) {
          const existingNames: string[] = (task as any).knownSiblingNames || [];
          if (!existingNames.includes(newName)) {
            (task as any).knownSiblingNames = [...existingNames, newName];
          }
        }
      }
    }
  };

  for (const task of taskQueue) {
    updateLabel(task);
  }
  for (const [, task] of dispatchedTasks) {
    updateLabel(task);
  }
}

/**
 * 規則 3：資訊去重 — 派發前再次檢查任務是否仍需要
 * 若資訊已被其他玩家填寫，靜默跳過
 */
export function isTaskStillNeeded(
  task: Phase2Task,
  virtualNodes: Map<string, VirtualNode>
): boolean {
  const targetNodeId = (task as any).targetNodeId;
  if (!targetNodeId) return true;
  const vnode = virtualNodes.get(targetNodeId);
  // 若節點不存在（可能已被去重合併刪除），任務不再需要
  if (!vnode) return false;

  switch (task.type) {
    case 'node-naming':
      return !vnode.name || vnode.name === '';
    case 'attribute-filling': {
      const attrType = (task as any).attributeType;
      if (attrType === 'gender') return vnode.gender === 'unknown';
      if (attrType === 'birthday') return !vnode.birthday;
      return true;
    }
    case 'upward-tracing': {
      const parentType = (task as any).parentType;
      if (parentType === 'father') return !vnode.fatherId;
      if (parentType === 'mother') return !vnode.motherId;
      return true;
    }
    case 'lateral-inquiry':
      // 如果已經確認過配偶狀態（lateral = true），不再需要
      return !vnode.efuStatus.lateral;
    case 'downward-inquiry':
      // 如果已經確認過子女狀態（downward = true），不再需要
      return !vnode.efuStatus.downward;
    default:
      return true;
  }
}

// ──────────────────────────────────────────────
// 輔助函式：任務建立
// ──────────────────────────────────────────────

function createNodeNamingTask(
  vnode: VirtualNode,
  priority: TaskPriority,
  counter: number,
  playerMap: Map<string, Player>,
  virtualNodes?: Map<string, VirtualNode>
): Phase2Task {
  const humanLabel = parseNodeIdToHumanLabel(vnode.id, playerMap, virtualNodes);
  
  // ── 子女消歧義：找出同一父母的兄弟姊妹，附帶已知名字 ──
  let siblingIndex: number | undefined;
  let knownSiblingNames: string[] | undefined;
  let parentName: string | undefined;
  
  if (virtualNodes) {
    // 找到此節點的父母（透過 fatherId / motherId）
    const parentId = vnode.fatherId || vnode.motherId;
    if (parentId) {
      const parentNode = virtualNodes.get(parentId);
      if (parentNode && parentNode.childrenIds.length > 1) {
        // 有多個子女 → 需消歧義
        parentName = parentNode.name && parentNode.name !== ''
          ? parentNode.name
          : parseNodeIdToHumanLabel(parentId, playerMap, virtualNodes);
        
        // 收集已命名的兄弟姊妹名字（排除自己、排除未命名的）
        knownSiblingNames = parentNode.childrenIds
          .filter(id => id !== vnode.id)
          .map(id => {
            const sibling = virtualNodes.get(id);
            if (!sibling) return '';
            if (sibling.isPlayer) {
              // 玩家節點一定有名字
              const player = Array.from(playerMap.values()).find(p => p.nodeId === id);
              return player?.name || sibling.name || '';
            }
            return sibling.name || '';
          })
          .filter(n => n !== '');
        
        // 計算此節點是第幾個子女（1-based）
        siblingIndex = parentNode.childrenIds.indexOf(vnode.id) + 1;
      }
    }
  }
  
  return {
    type: "node-naming",
    taskId: `task_naming_${vnode.id}_${counter}`,
    priority,
    efuDimension: "optional",
    targetNodeId: vnode.id,
    targetNodeLabel: humanLabel,
    siblingIndex,
    knownSiblingNames,
    parentName,
    assignedPlayerId: undefined,
    isLocked: false,
    createdAt: Date.now(),
  } as Phase2Task;
}

function createAttributeFillingTask(
  vnode: VirtualNode,
  attributeType: "gender" | "birthday" | "age",
  priority: TaskPriority,
  counter: number,
  playerMap: Map<string, Player>,
  virtualNodes?: Map<string, VirtualNode>
): Phase2Task {
  // 如果節點有名字就用名字，否則用人類可讀的標籤
  const humanLabel = vnode.name && vnode.name !== "" 
    ? vnode.name 
    : parseNodeIdToHumanLabel(vnode.id, playerMap, virtualNodes);
  
  return {
    type: "attribute-filling",
    taskId: `task_attr_${vnode.id}_${attributeType}_${counter}`,
    priority,
    efuDimension: attributeType === "birthday" ? "optional" : "upward",
    targetNodeId: vnode.id,
    targetNodeName: humanLabel,
    attributeType,
    assignedPlayerId: undefined,
    isLocked: false,
    createdAt: Date.now(),
  };
}

function createUpwardTracingTask(
  vnode: VirtualNode,
  parentType: "father" | "mother",
  priority: TaskPriority,
  counter: number,
  playerMap: Map<string, Player>,
  virtualNodes?: Map<string, VirtualNode>
): Phase2Task {
  // 如果節點有名字就用名字，否則用人類可讀的標籤
  const humanLabel = vnode.name && vnode.name !== "" 
    ? vnode.name 
    : parseNodeIdToHumanLabel(vnode.id, playerMap, virtualNodes);
  
  return {
    type: "upward-tracing",
    taskId: `task_upward_${vnode.id}_${parentType}_${counter}`,
    priority,
    efuDimension: "upward",
    targetNodeId: vnode.id,
    targetNodeName: humanLabel,
    parentType,
    assignedPlayerId: undefined,
    isLocked: false,
    createdAt: Date.now(),
  };
}

function createLateralInquiryTask(
  vnode: VirtualNode,
  priority: TaskPriority,
  counter: number,
  playerMap: Map<string, Player>,
  virtualNodes?: Map<string, VirtualNode>
): Phase2Task {
  const humanLabel = vnode.name && vnode.name !== ""
    ? vnode.name
    : parseNodeIdToHumanLabel(vnode.id, playerMap, virtualNodes);

  return {
    type: "lateral-inquiry",
    taskId: `task_lateral_${vnode.id}_${counter}`,
    priority,
    efuDimension: "lateral",
    targetNodeId: vnode.id,
    targetNodeName: humanLabel,
    assignedPlayerId: undefined,
    isLocked: false,
    createdAt: Date.now(),
  } as Phase2Task;
}

function createDownwardInquiryTask(
  vnode: VirtualNode,
  priority: TaskPriority,
  counter: number,
  playerMap: Map<string, Player>,
  knownChildrenCount: number,
  knownChildrenNames: string[],
  virtualNodes?: Map<string, VirtualNode>
): Phase2Task {
  const humanLabel = vnode.name && vnode.name !== ""
    ? vnode.name
    : parseNodeIdToHumanLabel(vnode.id, playerMap, virtualNodes);

  return {
    type: "downward-inquiry",
    taskId: `task_downward_${vnode.id}_${counter}`,
    priority,
    efuDimension: "downward",
    targetNodeId: vnode.id,
    targetNodeName: humanLabel,
    knownChildrenCount,
    knownChildrenNames,
    assignedPlayerId: undefined,
    isLocked: false,
    createdAt: Date.now(),
  } as Phase2Task;
}

// ──────────────────────────────────────────────
// 動態任務生成（配偶/子女確認後）
// ──────────────────────────────────────────────

/**
 * 當玩家確認有配偶時，動態建立配偶虛擬節點和相應任務
 */
export function createDynamicSpouseNode(
  room: Room,
  parentNodeId: string,
  virtualNodes: Map<string, VirtualNode>
): { spouseNode: VirtualNode; tasks: Phase2Task[] } {
  const parentNode = virtualNodes.get(parentNodeId)!;
  const spouseNodeId = `${parentNodeId}_S`;
  const playerMap = room.players;
  let taskCounter = Date.now(); // 使用時間戳避免 ID 衝突

  // 推斷配偶性別（與目標節點相反）
  const spouseGender: Gender = parentNode.gender === "male" ? "female"
    : parentNode.gender === "female" ? "male"
    : "unknown";

  const spouseNode: VirtualNode = {
    id: spouseNodeId,
    name: "",
    gender: spouseGender,
    isPlayer: false,
    isKeyNode: false, // 配偶非關鍵路徑，為終端擴張
    expansionType: "TERMINAL",
    efuStatus: {
      upward: true, // 終端擴張不需要追溯父母
      lateral: true, // 已知與 parentNode 為配偶
      downward: true, // 終端擴張不需要追溯子女
    },
    spouseIds: [parentNodeId],
    childrenIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // 建立配偶關係
  parentNode.spouseIds.push(spouseNodeId);

  // 同步子女：配偶共享 parentNode 的所有子女
  spouseNode.childrenIds = [...parentNode.childrenIds];

  virtualNodes.set(spouseNodeId, spouseNode);

  // 產生配偶的命名任務
  const tasks: Phase2Task[] = [];
  const namingTask = createNodeNamingTask(spouseNode, "L1", taskCounter++, playerMap, virtualNodes);
  tasks.push(namingTask);

  // 若性別未知，產生性別確認任務
  if (spouseGender === "unknown") {
    const genderTask = createAttributeFillingTask(spouseNode, "gender", "L2", taskCounter++, playerMap, virtualNodes);
    tasks.push(genderTask);
  }

  console.log(`[Phase 2] 動態建立配偶節點 ${spouseNodeId}，產生 ${tasks.length} 個任務`);
  return { spouseNode, tasks };
}

/**
 * 當玩家確認有子女時，動態建立子女虛擬節點和相應任務
 */
export function createDynamicChildrenNodes(
  room: Room,
  parentNodeId: string,
  childrenCount: number,
  virtualNodes: Map<string, VirtualNode>
): { childNodes: VirtualNode[]; tasks: Phase2Task[] } {
  const parentNode = virtualNodes.get(parentNodeId)!;
  const playerMap = room.players;
  let taskCounter = Date.now();

  const childNodes: VirtualNode[] = [];
  const tasks: Phase2Task[] = [];

  for (let i = 0; i < childrenCount; i++) {
    const childNodeId = `${parentNodeId}_C_any_${i + 1}`;

    // 避免重複建立
    if (virtualNodes.has(childNodeId)) continue;

    const childNode: VirtualNode = {
      id: childNodeId,
      name: "",
      gender: "unknown",
      isPlayer: false,
      isKeyNode: false, // 動態建立的子女非關鍵路徑
      expansionType: "TERMINAL",
      efuStatus: {
        upward: true, // 已知父母是 parentNode
        lateral: true, // 終端擴張不需要
        downward: true, // 終端擴張不需要
      },
      fatherId: parentNode.gender === "male" ? parentNodeId : undefined,
      motherId: parentNode.gender === "female" ? parentNodeId : undefined,
      spouseIds: [],
      childrenIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 如果 parentNode 有配偶，設置另一位父/母
    if (parentNode.spouseIds.length > 0) {
      const spouseId = parentNode.spouseIds[0];
      const spouse = virtualNodes.get(spouseId);
      if (spouse) {
        if (spouse.gender === "male") childNode.fatherId = spouseId;
        else if (spouse.gender === "female") childNode.motherId = spouseId;
        // 同步到配偶的 childrenIds
        if (!spouse.childrenIds.includes(childNodeId)) {
          spouse.childrenIds.push(childNodeId);
        }
      }
    }

    virtualNodes.set(childNodeId, childNode);
    parentNode.childrenIds.push(childNodeId);
    childNodes.push(childNode);

    // 產生命名任務
    const namingTask = createNodeNamingTask(childNode, "L1", taskCounter++, playerMap, virtualNodes);
    tasks.push(namingTask);

    // 產生性別確認任務
    const genderTask = createAttributeFillingTask(childNode, "gender", "L2", taskCounter++, playerMap, virtualNodes);
    tasks.push(genderTask);
  }

  console.log(`[Phase 2] 動態建立 ${childNodes.length} 個子女節點，產生 ${tasks.length} 個任務`);
  return { childNodes, tasks };
}

// ──────────────────────────────────────────────
// 任務派發
// ──────────────────────────────────────────────

/**
 * 根據優先級和玩家距離，派發下一個任務。
 * 演算法: (0.6 × Proximity) + (0.2 × ContributionScore) + (0.1 × RandomValue) - (0.1 × SkipCount)
 *
 * @param room 房間對象（包含已派發任務）
 * @param taskQueue 待派發任務隊列
 * @returns 選中的任務，若沒有可派發任務則為 null
 */
export function selectNextTaskToDispatch(
  room: Room,
  taskQueue: Phase2Task[]
): Phase2Task | null {
  if (taskQueue.length === 0) return null;

  const playerIds = Array.from(room.players.keys());
  if (playerIds.length === 0) return null;

  // 計算每個玩家的貢獻分數
  const contributionScores = new Map<string, number>();
  for (const playerId of playerIds) {
    const completed = room.phase2State?.playerStates.get(playerId)?.completedTasks.length ?? 0;
    const total = taskQueue.length;
    contributionScores.set(playerId, total > 0 ? 1 - completed / total : 0);
  }

  // 為每個任務選擇最佳玩家
  let bestScore = -Infinity;
  let selectedTask: Phase2Task | null = null;
  let selectedPlayerId: string | null = null;

  for (const task of taskQueue) {
    // 規則 3：資訊去重 — 派發前再次檢查任務是否仍需要
    if (!isTaskStillNeeded(task, room.familyTree.virtualNodes ?? new Map())) {
      continue;
    }

    // 規則 5：姓名優先 — 若節點尚未命名，只派發命名任務，不派發該節點的其他任務（如生日）
    const targetNodeId = (task as any).targetNodeId;
    if (targetNodeId && task.type !== 'node-naming') {
      const vnode = room.familyTree.virtualNodes?.get(targetNodeId);
      if (vnode && (!vnode.name || vnode.name === '')) {
        continue; // 跳過未命名節點的非命名任務
      }
    }

    for (const playerId of playerIds) {
      // 計算距離分數（1 = 最近，0 = 最遠）
      const proximity = calculateProximityScore(
        playerId,
        task.targetNodeId,
        room.familyTree.virtualNodes ?? new Map()
      );

      // 計算貢獻分數（0 = 貢獻最多的玩家，1 = 貢獻最少）
      const contribution = contributionScores.get(playerId) ?? 0;

      // 計算跳過懲罰
      const skipCount =
        room.phase2State?.playerStates.get(playerId)?.skippedTasks.get(task.taskId) ?? 0;

      // 組合評分
      const score =
        0.6 * proximity +
        0.2 * contribution +
        0.1 * Math.random() -
        0.1 * skipCount;

      if (score > bestScore) {
        bestScore = score;
        selectedTask = task;
        selectedPlayerId = playerId;
      }
    }
  }

  // 如果選中任務，標記為已派發
  if (selectedTask && selectedPlayerId) {
    selectedTask.assignedPlayerId = selectedPlayerId;
    selectedTask.isLocked = true;
  }

  return selectedTask ?? null;
}

/**
 * 為指定玩家選擇下一個任務。
 * 優先選擇與該玩家相關的任務（根據 proximity），確保任務分配給該玩家。
 *
 * @param room 房間對象
 * @param taskQueue 待派發任務隊列
 * @param targetPlayerId 目標玩家 ID
 * @returns 選中的任務，若沒有可派發任務則為 null
 */
export function selectNextTaskForPlayer(
  room: Room,
  taskQueue: Phase2Task[],
  targetPlayerId: string
): Phase2Task | null {
  if (taskQueue.length === 0) return null;

  // 計算該玩家的跳過記錄
  const playerState = room.phase2State?.playerStates.get(targetPlayerId);
  const skippedTasks = playerState?.skippedTasks ?? new Map<string, number>();

  // 按優先級排序任務（L1 > L2 > ... > L6）
  const priorityOrder: Record<string, number> = {
    'L1': 1,
    'L2': 2,
    'L3': 3,
    'L4': 4,
    'L5': 5,
    'L6': 6,
  };

  // 為每個任務計算評分
  let bestScore = -Infinity;
  let selectedTask: Phase2Task | null = null;

  for (const task of taskQueue) {
    // 規則 3：資訊去重 — 派發前再次檢查任務是否仍需要
    if (!isTaskStillNeeded(task, room.familyTree.virtualNodes ?? new Map())) {
      continue;
    }

    // 規則 5：姓名優先 — 若節點尚未命名，只派發命名任務，不派發該節點的其他任務
    const targetNodeId = (task as any).targetNodeId;
    if (targetNodeId && task.type !== 'node-naming') {
      const vnode = room.familyTree.virtualNodes?.get(targetNodeId);
      if (vnode && (!vnode.name || vnode.name === '')) {
        continue; // 跳過未命名節點的非命名任務
      }
    }

    // 計算優先級分數（L1 最高）
    const priorityScore = 10 - (priorityOrder[task.priority] ?? 5);

    // 計算與玩家的距離分數
    const proximity = calculateProximityScore(
      targetPlayerId,
      (task as any).targetNodeId,
      room.familyTree.virtualNodes ?? new Map()
    );

    // 計算跳過懲罰
    const skipCount = skippedTasks.get(task.taskId) ?? 0;

    // 組合評分：優先級 × 0.5 + 距離 × 0.4 + 隨機 × 0.1 - 跳過懲罰
    const score =
      0.5 * priorityScore +
      0.4 * proximity +
      0.1 * Math.random() -
      0.2 * skipCount;

    if (score > bestScore) {
      bestScore = score;
      selectedTask = task;
    }
  }

  // 如果選中任務，標記為已派發給目標玩家
  if (selectedTask) {
    selectedTask.assignedPlayerId = targetPlayerId;
    selectedTask.isLocked = true;
  }

  return selectedTask;
}

// ──────────────────────────────────────────────
// 輔助函式
// ──────────────────────────────────────────────

/**
 * 為虛擬節點生成唯一 ID
 */
function generateNodeId(parentNodeId: string, edge: EdgeType): string {
  // 簡化實現：使用 parentNodeId + edge 的組合作為 ID
  // 實際應用中可能需要更複雜的邏輯
  return `${parentNodeId}_${edge}`;
}

/**
 * 從邊類型推斷性別
 */
function inferGenderFromEdge(edge: EdgeType): Gender {
  if (edge === "C_m" || edge === "P_f") return "male";
  if (edge === "C_f" || edge === "P_m") return "female";
  return "unknown";
}

/**
 * 計算玩家到目標節點的距離相關性
 * 使用簡化的 BFS：距離越近，得分越高（1）
 *
 * @returns 0 到 1 之間的分數
 */
function calculateProximityScore(
  playerId: string,
  targetNodeId: string,
  virtualNodes: Map<string, VirtualNode>
): number {
  // TODO: 實現 BFS 來計算實際距離
  // 對於現在，簡單地返回隨機值
  return Math.random();
}

// ──────────────────────────────────────────────
// 同名節點偵測與匯聚任務生成
// ──────────────────────────────────────────────

/**
 * 當虛擬節點被命名後，掃描所有已命名的虛擬節點，
 * 若發現同名節點（不同 ID），產生「節點匯聚」確認任務。
 *
 * 提問時使用兩個不同路徑的描述來幫助玩家判斷：
 *   「A的祖父 與 B的祖父 XXX 是否為同一人？」
 *
 * @param namedNodeId 剛被命名的節點 ID
 * @param name 該節點的姓名
 * @param virtualNodes 虛擬節點 Map
 * @param playerMap 玩家 Map
 * @returns 需要加入任務隊列的匯聚任務陣列（可能多個同名候選）
 */
export function detectSameNameNodes(
  namedNodeId: string,
  name: string,
  virtualNodes: Map<string, VirtualNode>,
  playerMap: Map<string, Player>
): Phase2Task[] {
  if (!name || name.trim() === '') return [];

  const tasks: Phase2Task[] = [];
  const trimmedName = name.trim();

  for (const [nodeId, vnode] of virtualNodes) {
    if (nodeId === namedNodeId) continue;
    if (!vnode.name || vnode.name.trim() === '') continue;
    if (vnode.name.trim() !== trimmedName) continue;

    // 找到同名節點！產生匯聚確認任務
    // 使用路徑描述讓玩家辨識
    const namedNodeLabel = parseNodeIdToHumanLabel(namedNodeId, playerMap, virtualNodes);
    const candidateLabel = parseNodeIdToHumanLabel(nodeId, playerMap, virtualNodes);

    const task: Phase2Task = {
      type: "node-convergence",
      taskId: `task_convergence_${namedNodeId}_${nodeId}_${Date.now()}`,
      priority: "L2",
      efuDimension: "upward",
      targetNodeId: namedNodeId,
      targetNodeName: `${namedNodeLabel}（${trimmedName}）`,
      candidateNodeId: nodeId,
      candidateNodeName: `${candidateLabel}（${trimmedName}）`,
      assignedPlayerId: undefined,
      isLocked: false,
      createdAt: Date.now(),
    } as Phase2Task;

    tasks.push(task);
  }

  return tasks;
}

/**
 * 合併兩個虛擬節點（確認為同一人後）。
 * 將 sourceNodeId 的所有關係合併到 targetNodeId，然後刪除 sourceNodeId。
 *
 * @param keepNodeId 保留的節點 ID
 * @param removeNodeId 被合併（刪除）的節點 ID
 * @param virtualNodes 虛擬節點 Map
 */
export function mergeVirtualNodes(
  keepNodeId: string,
  removeNodeId: string,
  virtualNodes: Map<string, VirtualNode>
): void {
  const keepNode = virtualNodes.get(keepNodeId);
  const removeNode = virtualNodes.get(removeNodeId);
  if (!keepNode || !removeNode) return;

  // 合併屬性：保留已有值，補充缺失值
  if (!keepNode.name && removeNode.name) keepNode.name = removeNode.name;
  if (keepNode.gender === 'unknown' && removeNode.gender !== 'unknown') keepNode.gender = removeNode.gender;
  if (!keepNode.birthday && removeNode.birthday) keepNode.birthday = removeNode.birthday;
  if (!keepNode.fatherId && removeNode.fatherId) keepNode.fatherId = removeNode.fatherId;
  if (!keepNode.motherId && removeNode.motherId) keepNode.motherId = removeNode.motherId;

  // 合併配偶
  for (const spouseId of removeNode.spouseIds) {
    if (spouseId !== keepNodeId && !keepNode.spouseIds.includes(spouseId)) {
      keepNode.spouseIds.push(spouseId);
    }
  }

  // 合併子女
  for (const childId of removeNode.childrenIds) {
    if (childId !== keepNodeId && !keepNode.childrenIds.includes(childId)) {
      keepNode.childrenIds.push(childId);
    }
  }

  // 合併 EFU 狀態（取 OR）
  keepNode.efuStatus.upward = keepNode.efuStatus.upward || removeNode.efuStatus.upward;
  keepNode.efuStatus.lateral = keepNode.efuStatus.lateral || removeNode.efuStatus.lateral;
  keepNode.efuStatus.downward = keepNode.efuStatus.downward || removeNode.efuStatus.downward;

  // 關鍵路徑：任一為 true 則保留
  keepNode.isKeyNode = keepNode.isKeyNode || removeNode.isKeyNode;
  if (removeNode.expansionType === 'FULL') keepNode.expansionType = 'FULL';

  // 更新所有其他節點中對 removeNodeId 的引用
  for (const [, vnode] of virtualNodes) {
    if (vnode.fatherId === removeNodeId) vnode.fatherId = keepNodeId;
    if (vnode.motherId === removeNodeId) vnode.motherId = keepNodeId;
    vnode.childrenIds = vnode.childrenIds.map(id => id === removeNodeId ? keepNodeId : id);
    vnode.spouseIds = vnode.spouseIds.map(id => id === removeNodeId ? keepNodeId : id);
    // 去除自引用和重複
    vnode.childrenIds = [...new Set(vnode.childrenIds)].filter(id => id !== vnode.id);
    vnode.spouseIds = [...new Set(vnode.spouseIds)].filter(id => id !== vnode.id);
  }

  // 刪除被合併的節點
  virtualNodes.delete(removeNodeId);
  keepNode.updatedAt = Date.now();

  console.log(`[Phase 2 Merge] 節點 ${removeNodeId} 已合併至 ${keepNodeId}`);
}

/**
 * 初始化 EFU 追踪器
 */
export function initializeEFUTrackers(
  virtualNodes: Map<string, VirtualNode>
): Map<string, EFUTracker> {
  const trackers = new Map<string, EFUTracker>();

  for (const [nodeId, vnode] of virtualNodes) {
    trackers.set(nodeId, {
      nodeId,
      nodeName: vnode.name,
      isKeyNode: vnode.isKeyNode,
      completionStatus: vnode.efuStatus,
      remainingTasks: [],
    });
  }

  return trackers;
}
