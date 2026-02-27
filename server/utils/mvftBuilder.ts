/**
 * mvftBuilder.ts
 *
 * 骨架 MVFT（最小可行族譜）生成器
 *
 * 流程：
 *   玩家稱謂答案 (direction + title)
 *     → titleToPath()  → EdgeType[] 邏輯路徑（BFS on kinshipMap）
 *     → buildSkeletonMvft()  → MvftData（可直接傳送給前端）
 *
 * 參考規格：
 *   docs/features/relationship_path_resolution.md
 *   docs/concepts/mvft.md
 */

import type {
  EdgeType,
  RelationshipRecord,
  MvftData,
  MvftDisplayNode,
  MvftDisplayEdge,
} from "./gameState";
import kinshipMapRaw from "../../public/kinshipMap.json";

// ──────────────────────────────────────────────
// 1. KinshipMap 型別與 BFS 實作
// ──────────────────────────────────────────────

interface KinshipEdge {
  type: string;
  target: string;
}

interface KinshipNode {
  gender: string;
  titles?: { M: string; F: string };
  edges: KinshipEdge[];
}

type KinshipMapData = Record<string, KinshipNode>;

const kinshipMap = kinshipMapRaw as KinshipMapData;

// ── 稱謂別名表（口語/俗稱 → kinshipMap titles 的標準稱謂）────────
const TITLE_ALIASES: Record<string, string> = {
  // 直系
  父親: "爸爸", 爸: "爸爸", 老爸: "爸爸",
  母親: "媽媽", 媽: "媽媽", 老媽: "媽媽",
  // 配偶
  先生: "丈夫", 老公: "丈夫",
  太太: "妻子", 老婆: "妻子",
  配偶: "丈夫",        // 性別未知時 fallback 到 M，BFS 結果相同
  // 爺爺奶奶
  爺爺: "祖父", 阿公: "祖父",
  奶奶: "祖母", 阿嬤: "祖母",
  // 伯父/叔叔 → 叔伯
  叔叔: "叔伯", 伯父: "叔伯", 伯伯: "叔伯",
  // 姑姑別名
  姑: "姑姑",
  // 手足
  哥哥: "兄弟", 弟弟: "兄弟",
  姊姊: "姊妹", 妹妹: "姊妹", 姐姐: "姊妹", 姐妹: "姊妹",
  // 堂
  堂哥: "堂兄弟", 堂弟: "堂兄弟",
  堂姐: "堂姊妹", 堂妹: "堂姊妹", 堂姐妹: "堂姊妹",
  // 表
  表哥: "表兄弟", 表弟: "表兄弟",
  表姐: "表姊妹", 表妹: "表姊妹", 表姐妹: "表姊妹",
  // 外甥 → 侄子/侄女
  外甥: "侄子", 外甥女: "侄女",
};

// ── 中間虛擬節點的顯示標籤 ─────────────────────
const NODE_ROLE_LABELS: Record<string, string> = {
  father: "父親",
  mother: "母親",
  paternal_grandfather: "祖父",
  paternal_grandmother: "祖母",
  maternal_grandfather: "外公",
  maternal_grandmother: "外婆",
  paternal_uncle: "叔伯",
  paternal_aunt: "姑姑",
  maternal_uncle_aunt: "舅/阿姨",
  paternal_grandparents_unit: "祖父母",
  maternal_grandparents_unit: "外祖父母",
  paternal_great_grandparents_unit: "曾祖父母",
  maternal_great_grandparents_unit: "外曾祖父母",
  sibling: "兄弟姊妹",
  son: "兒子",
  daughter: "女兒",
  grandson: "孫輩",
  nephew_niece: "侄甥輩",
};

// ── title → {nodeId, genderKey} 查找表（模組載入時建立一次）──────
interface TitleLookupEntry {
  nodeId: string;
  genderKey: "M" | "F";
}

function buildTitleLookup(map: KinshipMapData): Map<string, TitleLookupEntry[]> {
  const lookup = new Map<string, TitleLookupEntry[]>();
  for (const [nodeId, node] of Object.entries(map)) {
    if (!node.titles) continue;
    const add = (title: string, gk: "M" | "F") => {
      if (!title) return;
      if (!lookup.has(title)) lookup.set(title, []);
      lookup.get(title)!.push({ nodeId, genderKey: gk });
    };
    add(node.titles.M, "M");
    if (node.titles.F !== node.titles.M) add(node.titles.F, "F");
  }
  return lookup;
}

const titleLookup = buildTitleLookup(kinshipMap);

// ── BFS：從 startId 到 targetId，回傳最短路徑（邊序列 + 節點序列）──

interface BfsResult {
  nodeIds: string[];   // 包含首尾節點
  edges: EdgeType[];   // edges.length === nodeIds.length - 1
}

function bfsFindPath(
  map: KinshipMapData,
  startId: string,
  targetId: string,
  maxSteps: number
): BfsResult | null {
  if (startId === targetId) return { nodeIds: [startId], edges: [] };

  type QItem = { nodeId: string; nodeIds: string[]; edges: EdgeType[] };
  const queue: QItem[] = [{ nodeId: startId, nodeIds: [startId], edges: [] }];
  const visited = new Set<string>([startId]);

  while (queue.length > 0) {
    const { nodeId, nodeIds, edges } = queue.shift()!;
    if (edges.length >= maxSteps) continue;

    const node = map[nodeId];
    if (!node) continue;

    for (const edge of node.edges) {
      const target = edge.target;
      if (visited.has(target)) continue;

      const newNodeIds = [...nodeIds, target];
      const newEdges = [...edges, edge.type as EdgeType];

      if (target === targetId) {
        return { nodeIds: newNodeIds, edges: newEdges };
      }

      visited.add(target);
      queue.push({ nodeId: target, nodeIds: newNodeIds, edges: newEdges });
    }
  }
  return null;
}

// ── 最後一條邊的性別細化（C_any → C_m/C_f，P_any → P_f/P_m）──────
function refineLastEdge(edges: EdgeType[], genderKey: "M" | "F"): EdgeType[] {
  if (edges.length === 0) return edges;
  const result = [...edges] as EdgeType[];
  const last = result[result.length - 1];
  if (last === "C_any") result[result.length - 1] = genderKey === "M" ? "C_m" : "C_f";
  else if (last === "P_any") result[result.length - 1] = genderKey === "M" ? "P_f" : "P_m";
  return result;
}

// ──────────────────────────────────────────────
// 對外 API
// ──────────────────────────────────────────────

export interface PathDef {
  path: EdgeType[];
  genderHint?: "male" | "female";
  /** 中間虛擬節點的顯示標籤（順序對應 path[0..n-2]） */
  roleLabels?: string[];
}

/**
 * 根據稱謂字串，透過 BFS 在 kinshipMap 上找出邏輯路徑。
 * 若稱謂無法對應或路徑超過五等親，回傳 null。
 *
 * @param title   稱謂字串（支援別名，如「哥哥」「表姐」）
 * @param context 歧義過濾：「paternal」/「maternal」可區分父系/母系
 */
export function titleToPath(
  title: string,
  context?: "paternal" | "maternal"
): PathDef | null {
  // 1. 別名標準化
  const normalized = TITLE_ALIASES[title] ?? title;

  // 2. 查找目標節點（可能有歧義：如「表兄弟」同時對應 paternal & maternal）
  const entries = titleLookup.get(normalized);
  if (!entries || entries.length === 0) return null;

  let candidates = entries;

  // 3. context 歧義過濾
  if (context && candidates.length > 1) {
    const filtered = candidates.filter((e) => e.nodeId.startsWith(context));
    if (filtered.length > 0) candidates = filtered;
  }

  // 4. BFS 找最短路徑（遍歷所有候選節點，取最短者）
  let bestResult: BfsResult | null = null;
  let bestEntry: TitleLookupEntry | null = null;

  for (const entry of candidates) {
    const result = bfsFindPath(kinshipMap, "self", entry.nodeId, 5);
    if (result && (!bestResult || result.edges.length < bestResult.edges.length)) {
      bestResult = result;
      bestEntry = entry;
    }
  }

  if (!bestResult || !bestEntry) return null;

  // 5. 最後一條邊性別細化
  const edges = refineLastEdge(bestResult.edges, bestEntry.genderKey);

  // 6. 中間節點 roleLabels（路徑中 self 與 target 之間的節點）
  const intermediateNodeIds = bestResult.nodeIds.slice(1, -1);
  const roleLabels = intermediateNodeIds.map(
    (nid) => NODE_ROLE_LABELS[nid] ?? nid
  );

  return {
    path: edges,
    genderHint: bestEntry.genderKey === "M" ? "male" : "female",
    roleLabels,
  };
}

// ──────────────────────────────────────────────
// 2. 輔助工具函式
// ──────────────────────────────────────────────

function edgeToRelType(edge: EdgeType): "parent" | "child" | "spouse" {
  if (edge.startsWith("P")) return "parent";
  if (edge.startsWith("C")) return "child";
  return "spouse";
}

function edgeToGender(edge: EdgeType): "male" | "female" | "unknown" {
  if (edge === "P_f" || edge === "C_m") return "male";
  if (edge === "P_m" || edge === "C_f") return "female";
  return "unknown";
}

function edgeToLabel(edge: EdgeType): string {
  const map: Record<string, string> = {
    P_f: "父", P_m: "母", P_any: "父/母",
    C_m: "子", C_f: "女", C_any: "子女",
    S: "配偶",
  };
  return map[edge] ?? edge;
}

/** 防止重複邊加入 */
function addEdgeIfNew(
  edges: MvftDisplayEdge[],
  edge: MvftDisplayEdge
): void {
  const exists = edges.some(
    (e) =>
      (e.type === "spouse" &&
        ((e.from === edge.from && e.to === edge.to) ||
         (e.from === edge.to && e.to === edge.from))) ||
      (e.type === "parent" && e.from === edge.from && e.to === edge.to)
  );
  if (!exists) edges.push(edge);
}

// ──────────────────────────────────────────────
// 3. 虛擬節點重複檢查（父母節點收斂）
// ──────────────────────────────────────────────

/**
 * 針對族譜中每個節點 B，檢查是否存在多個同性別的虛擬父母節點。
 * 若一個節點 B 同時具備多個男性虛擬節點指向它為 parent，代表這些節點應為同一個人（B 的父親）。
 * 女性虛擬節點（母親）同理。
 *
 * 針對族譜中每個節點 B，檢查是否存在多個同性別的虛擬父/母節點。
 * 若一個節點 B 同時具備多個男性虛擬節點指向它為 parent，代表這些應為同一人（B 的父親），進行合併。
 * 女性（母親）同理。
 *
 * ⚠️ 合併本身會引發級聯重複：留存節點繼承被合併節點的父母邊後，
 *    可能導致留存節點自身再次擁有多個同性別父母節點。
 *    因此採用迭代收斂策略，重複執行直到一個完整 pass 中沒有發生任何合併（不動點）。
 *
 * 操作流程（每個 pass）：
 * 1. 找出 B 的所有候選父母虛擬節點（按性別分組）
 * 2. 同性別超過一個時，將待刪除節點的所有邊重新指向留存節點
 * 3. 刪除再也用不到的虛擬節點，並清除合併後產生的重複邊
 * 4. 記錄本 pass 是否發生合併；若有則繼續下一 pass，直到收斂
 */
function deduplicateParentNodes(
  nodeMap: Map<string, MvftDisplayNode>,
  edges: MvftDisplayEdge[]
): void {
  /**
   * 執行單次掃描：找出所有節點中同性別重複的虛擬父母，執行合併。
   * @returns 本次 pass 是否發生了至少一次合併
   */
  const runOnePass = (): boolean => {
    const allNodeIds = Array.from(nodeMap.keys());
    const fatherCandidates = new Map<string, string[]>();
    const motherCandidates = new Map<string, string[]>();

    for (const childId of allNodeIds) {
      fatherCandidates.set(childId, []);
      motherCandidates.set(childId, []);
    }

    for (const edge of edges) {
      if (edge.type !== "parent") continue;
      const parentNode = nodeMap.get(edge.from);
      if (!parentNode || !parentNode.isVirtual) continue;

      const childId = edge.to;
      if (!fatherCandidates.has(childId)) continue;

      if (parentNode.gender === "male") {
        fatherCandidates.get(childId)!.push(edge.from);
      } else if (parentNode.gender === "female") {
        motherCandidates.get(childId)!.push(edge.from);
      }
    }

    /**
     * 對同一子節點下同性別的虛擬父母候選進行合併。
     * @returns 是否發生了合併
     */
    const mergeGroup = (candidates: Map<string, string[]>): boolean => {
      let merged = false;
      for (const [, parentIds] of candidates) {
        if (parentIds.length < 2) continue;

        const keepId = parentIds[0]!;
        const mergeIds = new Set(parentIds.slice(1));

        for (const edge of edges) {
          if (mergeIds.has(edge.from)) edge.from = keepId;
          if (mergeIds.has(edge.to)) edge.to = keepId;
        }

        for (const mergeId of mergeIds) {
          nodeMap.delete(mergeId);
        }

        merged = true;
      }

      // 合併後去重邊
      const seen = new Set<string>();
      for (let i = edges.length - 1; i >= 0; i--) {
        const e = edges[i]!;
        const key =
          e.type === "spouse"
            ? `spouse_${[e.from, e.to].sort().join("|")}`
            : `parent_${e.from}_${e.to}`;
        if (seen.has(key)) {
          edges.splice(i, 1);
        } else {
          seen.add(key);
        }
      }

      return merged;
    };

    const f = mergeGroup(fatherCandidates);
    const m = mergeGroup(motherCandidates);
    return f || m;
  };

  // 迭代收斂：重複執行直到不動點（本 pass 無任何合併）
  const MAX_PASSES = 20; // 防護上限，避免無限迴圈
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const changed = runOnePass();
    if (!changed) break;
  }
}

// ──────────────────────────────────────────────
// 4. 骨架 MVFT 生成器
// ──────────────────────────────────────────────

export interface PlayerInfo {
  playerId: string;
  nodeId: string;
  name: string;
  gender: "male" | "female";
  birthday?: string | Date;
}

/**
 * 根據所有關係紀錄，生成骨架 MVFT（用於前端顯示驗證）。
 *
 * 演算法：
 * 1. 將所有玩家加為 isPlayer=true 節點
 * 2. 對每筆 RelationshipRecord，沿著邏輯路徑依序生成虛擬節點與邊
 * 3. 路徑上的中間虛擬節點以 `virt_{sourceNodeId}_{edgePath}` 作為 ID，
 *    使同一玩家的相同方向路徑能自動合併（初步去重）
 * 4. 呼叫 deduplicateParentNodes() 進行父母節點收斂：
 *    若同一子節點存在多個同性別虛擬父/母節點，將其合併為同一節點
 */
export function buildSkeletonMvft(
  relationships: RelationshipRecord[],
  players: PlayerInfo[],
  virtualNodes?: Map<string, any>
): MvftData {
  const nodeMap = new Map<string, MvftDisplayNode>();
  const edges: MvftDisplayEdge[] = [];

  // ── 加入所有玩家節點 ─────────────────
  for (const p of players) {
    nodeMap.set(p.nodeId, {
      id: p.nodeId,
      label: p.name,
      gender: p.gender,
      isPlayer: true,
      playerId: p.playerId,
      isVirtual: false,
      isConfirmed: true,
      birthday: p.birthday
        ? (typeof p.birthday === 'string' ? p.birthday : new Date(p.birthday).toISOString().split('T')[0])
        : undefined,
    });
  }

  // ── 處理每筆關係紀錄 ─────────────────
  for (const record of relationships) {
    const { subjectNodeId, objectNodeId, path, roleLabels } = record;
    if (!path || path.length === 0) continue;

    // 確保 subject 與 object 節點已存在（應由玩家資料提供，但保護性加入）
    if (!nodeMap.has(subjectNodeId)) continue;
    if (!nodeMap.has(objectNodeId)) continue;

    // 建立沿途節點 ID 陣列：[subject, v1, v2, ..., object]
    const nodeIds: string[] = [subjectNodeId];

    for (let i = 0; i < path.length - 1; i++) {
      const edgeType = path[i]!;
      // 虛擬節點 ID 包含 subject + 路徑前綴，實現同方向路徑共用
      const virtualId = `virt_${subjectNodeId}_${path.slice(0, i + 1).join("_")}`;
      const gender = edgeToGender(edgeType);
      const label = roleLabels?.[i] ?? "?";

      if (!nodeMap.has(virtualId)) {
        nodeMap.set(virtualId, {
          id: virtualId,
          label,
          gender,
          isPlayer: false,
          isVirtual: true,
        });
      }
      nodeIds.push(virtualId);
    }

    nodeIds.push(objectNodeId);

    // 根據路徑建立邊
    for (let i = 0; i < path.length; i++) {
      const edgeType = path[i]!;
      const fromId = nodeIds[i]!;
      const toId = nodeIds[i + 1]!;
      const relDir = edgeToRelType(edgeType);
      const label = edgeToLabel(edgeType);

      if (relDir === "parent") {
        // 往上移動：toId 是 fromId 的父/母
        addEdgeIfNew(edges, { from: toId, to: fromId, type: "parent", label });
      } else if (relDir === "child") {
        // 往下移動：fromId 是 toId 的父/母
        addEdgeIfNew(edges, { from: fromId, to: toId, type: "parent", label });
      } else {
        // 配偶
        addEdgeIfNew(edges, { from: fromId, to: toId, type: "spouse", label: "配偶" });
      }
    }
  }

  // ── 步驟四：虛擬節點重複檢查（父母節點收斂）─────────────────
  deduplicateParentNodes(nodeMap, edges);

  // ── 步驟五：合併 Phase 2 動態建立的虛擬節點（配偶/子女）──────
  // buildSkeletonMvft 只根據 Phase 1 relationships 建構，
  // Phase 2 新增的配偶/子女節點不在 relationships 中，需手動加入。
  if (virtualNodes) {
    for (const [vnodeId, vnode] of virtualNodes) {
      // 嘗試匹配已存在的 MVFT 節點（可能有 virt_ 前綴）
      const mvftId = nodeMap.has(vnodeId) ? vnodeId
        : nodeMap.has(`virt_${vnodeId}`) ? `virt_${vnodeId}`
        : null;

      if (mvftId) {
        // 節點已存在：更新標籤、性別、生日、確認狀態
        const existing = nodeMap.get(mvftId)!;
        if (vnode.name && vnode.name !== '') {
          existing.label = vnode.name;
          existing.isConfirmed = true;
        }
        if (vnode.gender !== 'unknown') {
          existing.gender = vnode.gender;
        }
        if (vnode.birthday) {
          existing.birthday = typeof vnode.birthday === 'string'
            ? vnode.birthday
            : new Date(vnode.birthday).toISOString().split('T')[0];
        }
      } else {
        // 新節點（Phase 2 動態建立的配偶/子女），加入 MVFT
        const newNode: MvftDisplayNode = {
          id: vnodeId,
          label: vnode.name && vnode.name !== '' ? vnode.name : '？',
          gender: vnode.gender || 'unknown',
          isPlayer: vnode.isPlayer || false,
          playerId: vnode.playerId,
          isVirtual: !vnode.isPlayer,
          isConfirmed: !!(vnode.name && vnode.name !== ''),
          birthday: vnode.birthday
            ? (typeof vnode.birthday === 'string' ? vnode.birthday : new Date(vnode.birthday).toISOString().split('T')[0])
            : undefined,
        };
        nodeMap.set(vnodeId, newNode);

        // 建立配偶邊
        for (const spouseId of (vnode.spouseIds || [])) {
          const spouseMvftId = nodeMap.has(spouseId) ? spouseId
            : nodeMap.has(`virt_${spouseId}`) ? `virt_${spouseId}`
            : spouseId;
          addEdgeIfNew(edges, { from: spouseMvftId, to: vnodeId, type: 'spouse', label: '配偶' });
        }

        // 建立親子邊（此節點為父/母）
        for (const childId of (vnode.childrenIds || [])) {
          const childMvftId = nodeMap.has(childId) ? childId
            : nodeMap.has(`virt_${childId}`) ? `virt_${childId}`
            : childId;
          if (nodeMap.has(childMvftId)) {
            addEdgeIfNew(edges, { from: vnodeId, to: childMvftId, type: 'parent', label: edgeToLabel(vnode.gender === 'female' ? 'P_m' : 'P_f') });
          }
        }

        // 建立親子邊（此節點的父/母指向它）
        if (vnode.fatherId) {
          const fatherMvftId = nodeMap.has(vnode.fatherId) ? vnode.fatherId
            : nodeMap.has(`virt_${vnode.fatherId}`) ? `virt_${vnode.fatherId}`
            : vnode.fatherId;
          if (nodeMap.has(fatherMvftId)) {
            addEdgeIfNew(edges, { from: fatherMvftId, to: vnodeId, type: 'parent', label: '父' });
          }
        }
        if (vnode.motherId) {
          const motherMvftId = nodeMap.has(vnode.motherId) ? vnode.motherId
            : nodeMap.has(`virt_${vnode.motherId}`) ? `virt_${vnode.motherId}`
            : vnode.motherId;
          if (nodeMap.has(motherMvftId)) {
            addEdgeIfNew(edges, { from: motherMvftId, to: vnodeId, type: 'parent', label: '母' });
          }
        }
      }
    }

    // 更新玩家節點的生日資訊
    for (const p of players) {
      const playerNode = nodeMap.get(p.nodeId);
      if (playerNode) {
        playerNode.isConfirmed = true; // 玩家節點永遠已確認
      }
    }

    // ── 安全補丁：偵測無親子邊的孤兒節點，嘗試從 virtualNodes 補建邊 ──
    // 收集所有 parent edge 的目標節點（有被指向為子女的節點）
    const nodesWithParentEdge = new Set<string>();
    for (const e of edges) {
      if (e.type === 'parent') {
        nodesWithParentEdge.add(e.to);
      }
    }

    // 找出所有非根節點但缺少 parent edge 的節點
    const playerNodeIds = new Set(players.map(p => p.nodeId));
    for (const [nodeId, node] of nodeMap) {
      if (nodesWithParentEdge.has(nodeId)) continue; // 已有 parent edge
      if (node.isPlayer) continue; // 玩家節點可以是根節點

      // 此虛擬節點沒有任何 parent edge — 嘗試從 virtualNodes 找到其父母
      const vnode = virtualNodes.get(nodeId);
      if (!vnode) continue;

      // 方法 1：透過 fatherId/motherId 建邊
      let edgeCreated = false;
      if (vnode.fatherId) {
        const fatherMvftId = nodeMap.has(vnode.fatherId) ? vnode.fatherId
          : nodeMap.has(`virt_${vnode.fatherId}`) ? `virt_${vnode.fatherId}`
          : null;
        if (fatherMvftId && nodeMap.has(fatherMvftId)) {
          addEdgeIfNew(edges, { from: fatherMvftId, to: nodeId, type: 'parent', label: '父' });
          edgeCreated = true;
        }
      }
      if (vnode.motherId) {
        const motherMvftId = nodeMap.has(vnode.motherId) ? vnode.motherId
          : nodeMap.has(`virt_${vnode.motherId}`) ? `virt_${vnode.motherId}`
          : null;
        if (motherMvftId && nodeMap.has(motherMvftId)) {
          addEdgeIfNew(edges, { from: motherMvftId, to: nodeId, type: 'parent', label: '母' });
          edgeCreated = true;
        }
      }

      // 方法 2：反向查找 — 找到 childrenIds 包含此節點的虛擬節點
      if (!edgeCreated) {
        for (const [vnId, vn] of virtualNodes) {
          if (vn.childrenIds.includes(nodeId)) {
            const parentMvftId = nodeMap.has(vnId) ? vnId
              : nodeMap.has(`virt_${vnId}`) ? `virt_${vnId}`
              : null;
            if (parentMvftId && nodeMap.has(parentMvftId)) {
              const parentLabel = edgeToLabel(vn.gender === 'female' ? 'P_m' : 'P_f');
              addEdgeIfNew(edges, { from: parentMvftId, to: nodeId, type: 'parent', label: parentLabel });
              edgeCreated = true;
              break;
            }
          }
        }
      }

      if (!edgeCreated) {
        console.warn(`[MVFT] 孤兒節點偵測：${nodeId}（${node.label}）無親子邊指向它，dagre 可能將其置於頂層。virtualNode fatherId=${vnode.fatherId}, motherId=${vnode.motherId}`);
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
    generatedAt: Date.now(),
  };
}
