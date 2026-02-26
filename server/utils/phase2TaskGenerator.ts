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
   */
  function walkPath(
    edges: EdgeType[],
    startPlayerId: string,
    roleLabels: string[]
  ) {
    let currentNodeId = startPlayerId; // 從玩家節點開始

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const nextNodeId = generateNodeId(currentNodeId, edge);

      // Get or Create
      if (!virtualNodes.has(nextNodeId) && !createdNodeIds.has(nextNodeId)) {
        const nodeLabel = roleLabels[i] || edge;
        const nodeGender = inferGenderFromEdge(edge);

        const vnode: VirtualNode = {
          id: nextNodeId,
          name: "",
          gender: nodeGender,
          isPlayer: false,
          isKeyNode: true, // 所有從 relationships 實例化的節點初始都在關鍵路徑上
          expansionType: "FULL", // 預設完全擴張
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
          // 當前節點是 parent
          vnode.childrenIds.push(currentNodeId);
        } else if (edge.startsWith("C")) {
          // 當前節點是 child
          if (edge === "C_m") {
            // 下一個節點是兒子（男性）
            const childNode = virtualNodes.get(currentNodeId);
            if (childNode) childNode.fatherId = nextNodeId;
          } else if (edge === "C_f") {
            // 下一個節點是女兒（女性）
            const childNode = virtualNodes.get(currentNodeId);
            if (childNode) childNode.motherId = nextNodeId;
          }
        } else if (edge === "S") {
          // 配偶關係
          vnode.spouseIds.push(currentNodeId);
        }

        virtualNodes.set(nextNodeId, vnode);
        createdNodeIds.add(nextNodeId);
      }

      currentNodeId = nextNodeId;
    }
  }

  // 遍歷所有 relationships，為每個玩家實例化路徑
  for (const rel of relationships) {
    if (!rel.path || rel.path.length === 0) continue;
    walkPath(rel.path, rel.subjectPlayerId, rel.roleLabels || []);
  }

  // 確保所有玩家本身也是虛擬節點表中（如果還沒有的話）
  for (const [playerId, player] of playerMap) {
    if (!virtualNodes.has(playerId)) {
      virtualNodes.set(playerId, {
        id: playerId,
        name: player.name,
        gender: player.gender,
        isPlayer: true,
        playerId: playerId,
        isKeyNode: true,
        expansionType: "FULL",
        efuStatus: {
          upward: true, // 玩家本身視为已知
          lateral: true,
          downward: true,
        },
        spouseIds: [],
        childrenIds: [],
        createdAt: player.joinedAt,
        updatedAt: Date.now(),
      });
    }
  }

  return virtualNodes;
}

// ──────────────────────────────────────────────
// 節點 ID 解析與人類可讀標籤
// ──────────────────────────────────────────────

/**
 * 邊類型到中文稱謂的映射
 * 根據路徑邊序列產生人類可讀的親屬稱謂
 */
const EDGE_PATH_TO_LABEL: Record<string, string> = {
  // 一代
  "P_f": "爸爸",
  "P_m": "媽媽",
  "C_m": "兒子",
  "C_f": "女兒",
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
 * 從節點 ID 解析出起始玩家 ID 和邊序列
 * 節點 ID 格式：{playerId}_{edge1}_{edge2}...
 * 例如：6415d450-ab52-4916-a4a3-e5b036d3adfb_P_f → playerId + P_f
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
 * @param nodeId 節點 ID
 * @param playerMap 玩家映射表
 * @returns 人類可讀的標籤，如「小明的爸爸」
 */
function parseNodeIdToHumanLabel(
  nodeId: string,
  playerMap: Map<string, Player>
): string {
  const parsed = parseNodeIdComponents(nodeId);
  
  if (!parsed) {
    return nodeId; // 無法解析時返回原始 ID
  }
  
  const { playerId, edgePath } = parsed;
  const player = playerMap.get(playerId);
  const playerName = player?.name || "玩家";
  
  if (edgePath.length === 0) {
    return playerName; // 玩家本人
  }
  
  // 嘗試查找完整路徑的標籤
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
      // 未知邊類型
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
    const singleEdgeLabel = EDGE_PATH_TO_LABEL[edge] || "親屬";
    result = result ? `${result}的${singleEdgeLabel}` : singleEdgeLabel;
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
      if (vnode.isPlayer) continue; // 跳過玩家本身

      result.push({
        nodeId,
        priority: isKeyPathNode(nodeId) ? "critical" : "optional",
      });
    }

    return result;
  }

  const nodesToProcess = getNodesToProcess();
  const playerMap = room.players;

  // 第一部分：名字填充任務（所有虛擬節點）
  for (const { nodeId, priority } of nodesToProcess) {
    const vnode = virtualNodes.get(nodeId)!;
    if (!vnode.name || vnode.name === "") {
      const task = createNodeNamingTask(
        vnode,
        priority === "critical" ? "L1" : "L4",
        taskCounter++,
        playerMap
      );
      tasks.push(task);
    }
  }

  // 第二部分：性別填充任務（非玩家節點）
  for (const { nodeId, priority } of nodesToProcess) {
    const vnode = virtualNodes.get(nodeId)!;
    if (vnode.gender === "unknown") {
      const task = createAttributeFillingTask(
        vnode,
        "gender",
        priority === "critical" ? "L2" : "L4",
        taskCounter++,
        playerMap
      );
      tasks.push(task);
    }
  }

  // 第三部分：向上追溯任務（確認父母）
  for (const { nodeId, priority } of nodesToProcess) {
    const vnode = virtualNodes.get(nodeId)!;
    if (!vnode.efuStatus.upward && priority === "critical") {
      if (!vnode.fatherId) {
        const task = createUpwardTracingTask(
          vnode,
          "father",
          "L2",
          taskCounter++,
          playerMap
        );
        tasks.push(task);
      }
      if (!vnode.motherId) {
        const task = createUpwardTracingTask(
          vnode,
          "mother",
          "L2",
          taskCounter++,
          playerMap
        );
        tasks.push(task);
      }
    }
  }

  // 第四部分：配偶確認任務
  for (const { nodeId, priority } of nodesToProcess) {
    const vnode = virtualNodes.get(nodeId)!;
    if (!vnode.efuStatus.lateral && priority === "critical") {
      // 檢查是否需要配偶確認（根據其他玩家的陳述）
      // TODO: 實現配偶匹配邏輯
    }
  }

  // 第五部分：生日填充任務（可選）
  for (const { nodeId } of nodesToProcess) {
    const vnode = virtualNodes.get(nodeId)!;
    if (!vnode.birthday) {
      const task = createAttributeFillingTask(
        vnode,
        "birthday",
        "L5",
        taskCounter++,
        playerMap
      );
      tasks.push(task);
    }
  }

  return tasks;
}

// ──────────────────────────────────────────────
// 輔助函式：任務建立
// ──────────────────────────────────────────────

function createNodeNamingTask(
  vnode: VirtualNode,
  priority: TaskPriority,
  counter: number,
  playerMap: Map<string, Player>
): Phase2Task {
  const humanLabel = parseNodeIdToHumanLabel(vnode.id, playerMap);
  
  return {
    type: "node-naming",
    taskId: `task_naming_${vnode.id}_${counter}`,
    priority,
    efuDimension: "optional",
    targetNodeId: vnode.id,
    targetNodeLabel: humanLabel,
    assignedPlayerId: undefined,
    isLocked: false,
    createdAt: Date.now(),
  };
}

function createAttributeFillingTask(
  vnode: VirtualNode,
  attributeType: "gender" | "birthday" | "age",
  priority: TaskPriority,
  counter: number,
  playerMap: Map<string, Player>
): Phase2Task {
  // 如果節點有名字就用名字，否則用人類可讀的標籤
  const humanLabel = vnode.name && vnode.name !== "" 
    ? vnode.name 
    : parseNodeIdToHumanLabel(vnode.id, playerMap);
  
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
  playerMap: Map<string, Player>
): Phase2Task {
  // 如果節點有名字就用名字，否則用人類可讀的標籤
  const humanLabel = vnode.name && vnode.name !== "" 
    ? vnode.name 
    : parseNodeIdToHumanLabel(vnode.id, playerMap);
  
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
