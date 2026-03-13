/**
 * Phase 3：驗證出題產生器
 *
 * 根據 MVFT 族譜資料產生驗證問題，支援 7 大類題型：
 *   1. 親子關係確認  2. 配偶關係確認  3. 子女數量驗證
 *   4. 稱謂反查      5. 屬性驗證      6. 兄弟姐妹驗證
 *   7. 路徑關係驗證
 *
 * 覆蓋率目標: 50-70% 的族譜節點與屬性
 */

import type {
  Room,
  VirtualNode,
  VerificationQuestion,
  VerificationCategory,
  VerificationAnswerFormat,
  Phase3State,
} from "./gameState";

// ════════════════════════════════════════════════════════════════
// 常數：題型權重
// ════════════════════════════════════════════════════════════════

const CATEGORY_WEIGHTS: Record<VerificationCategory, number> = {
  "parent-confirm": 25,
  "spouse-confirm": 15,
  "children-count": 15,
  "kinship-reverse": 20,
  "attribute-verify": 10,
  "sibling-verify": 10,
  "path-relation": 5,
};

// ════════════════════════════════════════════════════════════════
// 初始化 Phase 3 狀態
// ════════════════════════════════════════════════════════════════

export function initializePhase3State(room: Room): Phase3State {
  const questionPool = generateAllVerificationQuestions(room);

  // 按優先級排序（高優先在前）
  questionPool.sort((a, b) => b.priority - a.priority);

  const state: Phase3State = {
    questionPool,
    dispatchedQuestions: new Map(),
    completedResults: [],
    pendingForwards: new Map(),
    verifiedAttributes: new Set(),
    conflictRecords: [],
    playerVerificationScores: new Map(),
    stats: {
      totalQuestionsAsked: 0,
      verifiedCorrect: 0,
      treeCorrections: 0,
      unresolvedConflicts: 0,
    },
  };

  // 初始化每位玩家的驗證得分
  for (const [playerId] of room.players) {
    state.playerVerificationScores.set(playerId, 0);
  }

  return state;
}

// ════════════════════════════════════════════════════════════════
// 產生所有候選驗證問題
// ════════════════════════════════════════════════════════════════

function generateAllVerificationQuestions(room: Room): VerificationQuestion[] {
  const pool: VerificationQuestion[] = [];
  const virtualNodes = room.familyTree.virtualNodes;
  if (!virtualNodes || virtualNodes.size === 0) return pool;

  // 收集所有已填寫的虛擬節點（有名字的）
  const filledNodes: VirtualNode[] = [];
  for (const [, node] of virtualNodes) {
    if (node.name && node.name !== "未知") {
      filledNodes.push(node);
    }
  }

  // 加入玩家節點
  const playerNodes: VirtualNode[] = [];
  for (const [, node] of virtualNodes) {
    if (node.isPlayer) {
      playerNodes.push(node);
    }
  }
  const allKnownNodes = [...new Set([...filledNodes, ...playerNodes])];

  for (const node of allKnownNodes) {
    // 類別 1：親子關係確認
    pool.push(...generateParentConfirmQuestions(node, virtualNodes));

    // 類別 2：配偶關係確認
    pool.push(...generateSpouseConfirmQuestions(node, virtualNodes));

    // 類別 3：子女數量驗證
    pool.push(...generateChildrenCountQuestions(node, virtualNodes));

    // 類別 5：屬性驗證
    pool.push(...generateAttributeVerifyQuestions(node, virtualNodes));

    // 類別 6：兄弟姐妹驗證
    pool.push(...generateSiblingVerifyQuestions(node, virtualNodes));
  }

  // 類別 4：稱謂反查（需要玩家資訊）
  pool.push(...generateKinshipReverseQuestions(room, virtualNodes));

  // 類別 7：路徑關係驗證
  pool.push(...generatePathRelationQuestions(room, virtualNodes));

  return pool;
}

// ════════════════════════════════════════════════════════════════
// 類別 1：親子關係確認
// ════════════════════════════════════════════════════════════════

function generateParentConfirmQuestions(
  node: VirtualNode,
  virtualNodes: Map<string, VirtualNode>
): VerificationQuestion[] {
  const questions: VerificationQuestion[] = [];

  // 1-1: [A] 是 [B] 的父親嗎？
  if (node.fatherId) {
    const father = virtualNodes.get(node.fatherId);
    if (father && father.name && father.name !== "未知") {
      questions.push(createQuestion({
        category: "parent-confirm",
        template: "1-1",
        questionText: `${father.name} 是 ${node.name} 的父親嗎？`,
        answerFormat: "yes-no",
        treeValue: true,
        targetNodeId: node.id,
        targetNodeName: node.name,
        relatedNodeId: father.id,
        relatedNodeName: father.name,
        isKeyNode: node.isKeyNode || father.isKeyNode,
        priority: computePriority(node, "parent-confirm"),
        phase2FillerPlayerIds: [],
      }));
    }
  }

  // 1-2: [A] 是 [B] 的母親嗎？
  if (node.motherId) {
    const mother = virtualNodes.get(node.motherId);
    if (mother && mother.name && mother.name !== "未知") {
      questions.push(createQuestion({
        category: "parent-confirm",
        template: "1-2",
        questionText: `${mother.name} 是 ${node.name} 的母親嗎？`,
        answerFormat: "yes-no",
        treeValue: true,
        targetNodeId: node.id,
        targetNodeName: node.name,
        relatedNodeId: mother.id,
        relatedNodeName: mother.name,
        isKeyNode: node.isKeyNode || mother.isKeyNode,
        priority: computePriority(node, "parent-confirm"),
        phase2FillerPlayerIds: [],
      }));
    }
  }

  // 1-3/1-4: 反向 — [A] 是 [B] 的兒子/女兒嗎？
  if (node.childrenIds.length > 0) {
    for (const childId of node.childrenIds) {
      const child = virtualNodes.get(childId);
      if (child && child.name && child.name !== "未知") {
        const genderLabel = child.gender === "male" ? "兒子" : child.gender === "female" ? "女兒" : "小孩";
        questions.push(createQuestion({
          category: "parent-confirm",
          template: child.gender === "male" ? "1-3" : "1-4",
          questionText: `${child.name} 是 ${node.name} 的${genderLabel}嗎？`,
          answerFormat: "yes-no",
          treeValue: true,
          targetNodeId: node.id,
          targetNodeName: node.name,
          relatedNodeId: child.id,
          relatedNodeName: child.name,
          isKeyNode: node.isKeyNode || child.isKeyNode,
          priority: computePriority(node, "parent-confirm"),
          phase2FillerPlayerIds: [],
        }));
      }
    }
  }

  return questions;
}

// ════════════════════════════════════════════════════════════════
// 類別 2：配偶關係確認
// ════════════════════════════════════════════════════════════════

function generateSpouseConfirmQuestions(
  node: VirtualNode,
  virtualNodes: Map<string, VirtualNode>
): VerificationQuestion[] {
  const questions: VerificationQuestion[] = [];

  // 2-1: [A] 是否有配偶？
  if (node.name && node.name !== "未知") {
    const hasSpouse = node.spouseIds.length > 0;
    questions.push(createQuestion({
      category: "spouse-confirm",
      template: "2-1",
      questionText: `${node.name} 是否有配偶？`,
      answerFormat: "yes-no",
      treeValue: hasSpouse,
      targetNodeId: node.id,
      targetNodeName: node.name,
      isKeyNode: node.isKeyNode,
      priority: computePriority(node, "spouse-confirm"),
      phase2FillerPlayerIds: [],
    }));
  }

  // 2-2: [A] 和 [B] 是配偶嗎？
  for (const spouseId of node.spouseIds) {
    const spouse = virtualNodes.get(spouseId);
    if (spouse && spouse.name && spouse.name !== "未知") {
      questions.push(createQuestion({
        category: "spouse-confirm",
        template: "2-2",
        questionText: `${node.name} 和 ${spouse.name} 是配偶嗎？`,
        answerFormat: "yes-no",
        treeValue: true,
        targetNodeId: node.id,
        targetNodeName: node.name,
        relatedNodeId: spouse.id,
        relatedNodeName: spouse.name,
        isKeyNode: node.isKeyNode || spouse.isKeyNode,
        priority: computePriority(node, "spouse-confirm"),
        phase2FillerPlayerIds: [],
      }));
    }
  }

  return questions;
}

// ════════════════════════════════════════════════════════════════
// 類別 3：子女數量驗證
// ════════════════════════════════════════════════════════════════

function generateChildrenCountQuestions(
  node: VirtualNode,
  virtualNodes: Map<string, VirtualNode>
): VerificationQuestion[] {
  const questions: VerificationQuestion[] = [];

  if (node.childrenIds.length === 0 && !node.isPlayer) return questions;

  // 3-1: [A] 有幾位小孩？
  const childCount = node.childrenIds.length;
  if (node.name && node.name !== "未知") {
    questions.push(createQuestion({
      category: "children-count",
      template: "3-1",
      questionText: `${node.name} 有幾位小孩？`,
      answerFormat: "number",
      treeValue: childCount,
      targetNodeId: node.id,
      targetNodeName: node.name,
      isKeyNode: node.isKeyNode,
      priority: computePriority(node, "children-count"),
      phase2FillerPlayerIds: [],
    }));

    // 3-2 / 3-3: 分性別子女數
    const sons = node.childrenIds.filter(cid => {
      const c = virtualNodes.get(cid);
      return c && c.gender === "male";
    });
    const daughters = node.childrenIds.filter(cid => {
      const c = virtualNodes.get(cid);
      return c && c.gender === "female";
    });

    if (sons.length > 0 || daughters.length > 0) {
      questions.push(createQuestion({
        category: "children-count",
        template: "3-2",
        questionText: `${node.name} 有幾個兒子？`,
        answerFormat: "number",
        treeValue: sons.length,
        targetNodeId: node.id,
        targetNodeName: node.name,
        isKeyNode: node.isKeyNode,
        priority: computePriority(node, "children-count") - 1,
        phase2FillerPlayerIds: [],
      }));

      questions.push(createQuestion({
        category: "children-count",
        template: "3-3",
        questionText: `${node.name} 有幾個女兒？`,
        answerFormat: "number",
        treeValue: daughters.length,
        targetNodeId: node.id,
        targetNodeName: node.name,
        isKeyNode: node.isKeyNode,
        priority: computePriority(node, "children-count") - 1,
        phase2FillerPlayerIds: [],
      }));
    }

    // 3-4: [A] 的小孩中有 [B] 嗎？
    for (const childId of node.childrenIds) {
      const child = virtualNodes.get(childId);
      if (child && child.name && child.name !== "未知") {
        questions.push(createQuestion({
          category: "children-count",
          template: "3-4",
          questionText: `${node.name} 的小孩中有 ${child.name} 嗎？`,
          answerFormat: "yes-no",
          treeValue: true,
          targetNodeId: node.id,
          targetNodeName: node.name,
          relatedNodeId: child.id,
          relatedNodeName: child.name,
          isKeyNode: node.isKeyNode,
          priority: computePriority(node, "children-count") - 2,
          phase2FillerPlayerIds: [],
        }));
      }
    }
  }

  return questions;
}

// ════════════════════════════════════════════════════════════════
// 類別 4：稱謂反查
// ════════════════════════════════════════════════════════════════

function generateKinshipReverseQuestions(
  room: Room,
  virtualNodes: Map<string, VirtualNode>
): VerificationQuestion[] {
  const questions: VerificationQuestion[] = [];

  // 利用 relationship records 產生稱謂反查題
  for (const rel of room.relationships) {
    const subject = room.players.get(rel.subjectPlayerId);
    const object = room.players.get(rel.objectPlayerId);
    if (!subject || !object) continue;

    // 4-3: [A] 叫 [B] 什麼稱呼？
    if (rel.title) {
      questions.push(createQuestion({
        category: "kinship-reverse",
        template: "4-3",
        questionText: `${subject.name} 叫 ${object.name} 什麼稱呼？`,
        answerFormat: "text",
        treeValue: rel.title,
        targetNodeId: rel.subjectNodeId,
        targetNodeName: subject.name,
        relatedNodeId: rel.objectNodeId,
        relatedNodeName: object.name,
        isKeyNode: true,
        priority: computePriority(null, "kinship-reverse") + 5,
        phase2FillerPlayerIds: [rel.subjectPlayerId],
      }));
    }
  }

  // 4-1: [A] 的 [稱謂] 叫做什麼名字？（從已填名字的虛擬節點與玩家節點關係反查）
  for (const [, node] of virtualNodes) {
    if (!node.isPlayer || !node.name) continue;

    // 從父親查
    if (node.fatherId) {
      const father = virtualNodes.get(node.fatherId);
      if (father && father.name && father.name !== "未知") {
        const options = getNameOptionsFromNodes(virtualNodes, father.id, 4);
        questions.push(createQuestion({
          category: "kinship-reverse",
          template: "4-1",
          questionText: `${node.name} 的爸爸叫做什麼名字？`,
          answerFormat: "multiple-choice",
          options,
          treeValue: father.name,
          targetNodeId: node.id,
          targetNodeName: node.name,
          relatedNodeId: father.id,
          relatedNodeName: father.name,
          isKeyNode: true,
          priority: computePriority(node, "kinship-reverse"),
          phase2FillerPlayerIds: [],
        }));
      }
    }

    // 從母親查
    if (node.motherId) {
      const mother = virtualNodes.get(node.motherId);
      if (mother && mother.name && mother.name !== "未知") {
        const options = getNameOptionsFromNodes(virtualNodes, mother.id, 4);
        questions.push(createQuestion({
          category: "kinship-reverse",
          template: "4-1",
          questionText: `${node.name} 的媽媽叫做什麼名字？`,
          answerFormat: "multiple-choice",
          options,
          treeValue: mother.name,
          targetNodeId: node.id,
          targetNodeName: node.name,
          relatedNodeId: mother.id,
          relatedNodeName: mother.name,
          isKeyNode: true,
          priority: computePriority(node, "kinship-reverse"),
          phase2FillerPlayerIds: [],
        }));
      }
    }
  }

  return questions;
}

// ════════════════════════════════════════════════════════════════
// 類別 5：屬性驗證
// ════════════════════════════════════════════════════════════════

function generateAttributeVerifyQuestions(
  node: VirtualNode,
  _virtualNodes: Map<string, VirtualNode>
): VerificationQuestion[] {
  const questions: VerificationQuestion[] = [];
  if (!node.name || node.name === "未知") return questions;

  // 5-1: [A] 是男性還是女性？
  if (node.gender && node.gender !== "unknown") {
    questions.push(createQuestion({
      category: "attribute-verify",
      template: "5-1",
      questionText: `${node.name} 是男性還是女性？`,
      answerFormat: "gender",
      treeValue: node.gender,
      targetNodeId: node.id,
      targetNodeName: node.name,
      isKeyNode: node.isKeyNode,
      priority: computePriority(node, "attribute-verify"),
      phase2FillerPlayerIds: [],
    }));
  }

  // 5-2: [A] 的生日是 [日期] 嗎？
  if (node.birthday) {
    const birthday = node.birthday instanceof Date ? node.birthday : new Date(node.birthday);
    if (!isNaN(birthday.getTime())) {
      const year = birthday.getFullYear();
      questions.push(createQuestion({
        category: "attribute-verify",
        template: "5-2",
        questionText: `${node.name} 出生於 ${year} 年嗎？`,
        answerFormat: "yes-no",
        treeValue: true,
        targetNodeId: node.id,
        targetNodeName: node.name,
        isKeyNode: node.isKeyNode,
        priority: computePriority(node, "attribute-verify") - 2,
        phase2FillerPlayerIds: [],
      }));
    }
  }

  return questions;
}

// ════════════════════════════════════════════════════════════════
// 類別 6：兄弟姐妹驗證
// ════════════════════════════════════════════════════════════════

function generateSiblingVerifyQuestions(
  node: VirtualNode,
  virtualNodes: Map<string, VirtualNode>
): VerificationQuestion[] {
  const questions: VerificationQuestion[] = [];
  if (!node.name || node.name === "未知") return questions;

  // 找出同胞（同父或同母的其他節點）
  const siblings = findSiblings(node, virtualNodes);
  if (siblings.length === 0) return questions;

  // 6-1: [A] 有幾位兄弟姐妹？
  questions.push(createQuestion({
    category: "sibling-verify",
    template: "6-1",
    questionText: `${node.name} 有幾位兄弟姐妹？（不含自己）`,
    answerFormat: "number",
    treeValue: siblings.length,
    targetNodeId: node.id,
    targetNodeName: node.name,
    isKeyNode: node.isKeyNode,
    priority: computePriority(node, "sibling-verify"),
    phase2FillerPlayerIds: [],
  }));

  // 6-2: [A] 和 [B] 是兄弟/姐妹嗎？
  for (const sibling of siblings) {
    if (sibling.name && sibling.name !== "未知") {
      questions.push(createQuestion({
        category: "sibling-verify",
        template: "6-2",
        questionText: `${node.name} 和 ${sibling.name} 是兄弟姐妹嗎？`,
        answerFormat: "yes-no",
        treeValue: true,
        targetNodeId: node.id,
        targetNodeName: node.name,
        relatedNodeId: sibling.id,
        relatedNodeName: sibling.name,
        isKeyNode: node.isKeyNode,
        priority: computePriority(node, "sibling-verify") - 1,
        phase2FillerPlayerIds: [],
      }));
    }
  }

  return questions;
}

// ════════════════════════════════════════════════════════════════
// 類別 7：路徑關係驗證
// ════════════════════════════════════════════════════════════════

function generatePathRelationQuestions(
  room: Room,
  _virtualNodes: Map<string, VirtualNode>
): VerificationQuestion[] {
  const questions: VerificationQuestion[] = [];

  // 7-3: [A] 和 [B] 有血緣關係嗎？ — 從 relationship records 產生
  const playerList = Array.from(room.players.values()).filter(p => !p.isObserver);
  for (let i = 0; i < playerList.length; i++) {
    for (let j = i + 1; j < playerList.length; j++) {
      const pA = playerList[i];
      const pB = playerList[j];
      // 如果有 relationship record，代表有關係
      const hasRelation = room.relationships.some(
        r =>
          (r.subjectPlayerId === pA.playerId && r.objectPlayerId === pB.playerId) ||
          (r.subjectPlayerId === pB.playerId && r.objectPlayerId === pA.playerId)
      );
      questions.push(createQuestion({
        category: "path-relation",
        template: "7-3",
        questionText: `${pA.name} 和 ${pB.name} 有親屬關係嗎？`,
        answerFormat: "yes-no",
        treeValue: hasRelation,
        targetNodeId: pA.nodeId,
        targetNodeName: pA.name,
        relatedNodeId: pB.nodeId,
        relatedNodeName: pB.name,
        isKeyNode: true,
        priority: computePriority(null, "path-relation"),
        phase2FillerPlayerIds: [],
      }));
    }
  }

  return questions;
}

// ════════════════════════════════════════════════════════════════
// 問題派發
// ════════════════════════════════════════════════════════════════

/**
 * 為指定玩家選取下一道驗證問題
 *
 * 派發規則：
 * 1. 迴避自填：優先不派給 Phase 2 填寫者
 * 2. 親疏匹配：與該節點關係近的玩家優先
 * 3. 不重複：同題不重複派給同玩家
 * 4. 優先級：按 priority 排序
 */
export function selectNextVerificationQuestion(
  phase3State: Phase3State,
  playerId: string
): VerificationQuestion | null {
  // 優先處理轉發的問題（高優先級插隊）
  for (const [qId, forwarded] of phase3State.pendingForwards) {
    if (
      forwarded.assignedPlayerId === playerId ||
      (!forwarded.assignedPlayerId && !forwarded.phase2FillerPlayerIds.includes(playerId) && forwarded.originalAnswerPlayerId !== playerId)
    ) {
      forwarded.assignedPlayerId = playerId;
      forwarded.dispatchedAt = Date.now();
      phase3State.pendingForwards.delete(qId);
      phase3State.dispatchedQuestions.set(qId, forwarded);
      return forwarded;
    }
  }

  // 從問題池選取
  for (let i = 0; i < phase3State.questionPool.length; i++) {
    const q = phase3State.questionPool[i];

    // 跳過自填者
    if (q.phase2FillerPlayerIds.includes(playerId)) continue;

    // 選中這題
    phase3State.questionPool.splice(i, 1);
    q.assignedPlayerId = playerId;
    q.dispatchedAt = Date.now();
    phase3State.dispatchedQuestions.set(q.questionId, q);
    return q;
  }

  // 沒有更多問題 — 也考慮可以讓自填者回答（降低門檻）
  for (let i = 0; i < phase3State.questionPool.length; i++) {
    const q = phase3State.questionPool[i];
    phase3State.questionPool.splice(i, 1);
    q.assignedPlayerId = playerId;
    q.dispatchedAt = Date.now();
    phase3State.dispatchedQuestions.set(q.questionId, q);
    return q;
  }

  return null;
}

/**
 * 建立一道轉發問題（情況B：答案 ≠ 族譜時觸發）
 */
export function createForwardQuestion(
  original: VerificationQuestion,
  originalAnswer: any,
  originalPlayerId: string,
  room: Room
): VerificationQuestion | null {
  const forwardQ: VerificationQuestion = {
    ...original,
    questionId: crypto.randomUUID(),
    isForwarded: true,
    originalAnswerPlayerId: originalPlayerId,
    originalAnswer: originalAnswer,
    assignedPlayerId: undefined,
    dispatchedAt: undefined,
    createdAt: Date.now(),
    priority: original.priority + 100, // 轉發題高優先
  };

  // 找最合適的玩家（迴避原答者、迴避原填者）
  const candidates = Array.from(room.players.values()).filter(
    p => !p.isObserver && !p.isOffline && p.playerId !== originalPlayerId && !original.phase2FillerPlayerIds.includes(p.playerId)
  );

  if (candidates.length === 0) {
    // 找到所有可用玩家（只排除原答者）
    const fallback = Array.from(room.players.values()).filter(
      p => !p.isObserver && !p.isOffline && p.playerId !== originalPlayerId
    );
    if (fallback.length === 0) return null;
    forwardQ.assignedPlayerId = fallback[Math.floor(Math.random() * fallback.length)].playerId;
  } else {
    forwardQ.assignedPlayerId = candidates[Math.floor(Math.random() * candidates.length)].playerId;
  }

  return forwardQ;
}

// ════════════════════════════════════════════════════════════════
// 工具函式
// ════════════════════════════════════════════════════════════════

function createQuestion(params: {
  category: VerificationCategory;
  template: string;
  questionText: string;
  answerFormat: VerificationAnswerFormat;
  options?: string[];
  treeValue: any;
  targetNodeId: string;
  targetNodeName: string;
  relatedNodeId?: string;
  relatedNodeName?: string;
  isKeyNode: boolean;
  priority: number;
  phase2FillerPlayerIds: string[];
}): VerificationQuestion {
  return {
    questionId: crypto.randomUUID(),
    category: params.category,
    template: params.template,
    questionText: params.questionText,
    answerFormat: params.answerFormat,
    options: params.options,
    treeValue: params.treeValue,
    targetNodeId: params.targetNodeId,
    targetNodeName: params.targetNodeName,
    relatedNodeId: params.relatedNodeId,
    relatedNodeName: params.relatedNodeName,
    isKeyNode: params.isKeyNode,
    priority: params.priority,
    assignedPlayerId: undefined,
    isForwarded: false,
    phase2FillerPlayerIds: params.phase2FillerPlayerIds,
    createdAt: Date.now(),
  };
}

function computePriority(node: VirtualNode | null, category: VerificationCategory): number {
  let base = CATEGORY_WEIGHTS[category] || 10;
  if (node?.isKeyNode) base += 20;
  if (node?.isPlayer) base += 10;
  // 添加隨機擾動（同優先級內隨機）
  base += Math.random() * 3;
  return Math.round(base * 10) / 10;
}

function findSiblings(node: VirtualNode, virtualNodes: Map<string, VirtualNode>): VirtualNode[] {
  const siblings: VirtualNode[] = [];
  const siblingIds = new Set<string>();

  // 同父
  if (node.fatherId) {
    const father = virtualNodes.get(node.fatherId);
    if (father) {
      for (const childId of father.childrenIds) {
        if (childId !== node.id && !siblingIds.has(childId)) {
          const child = virtualNodes.get(childId);
          if (child) {
            siblings.push(child);
            siblingIds.add(childId);
          }
        }
      }
    }
  }

  // 同母
  if (node.motherId) {
    const mother = virtualNodes.get(node.motherId);
    if (mother) {
      for (const childId of mother.childrenIds) {
        if (childId !== node.id && !siblingIds.has(childId)) {
          const child = virtualNodes.get(childId);
          if (child) {
            siblings.push(child);
            siblingIds.add(childId);
          }
        }
      }
    }
  }

  return siblings;
}

/**
 * 產生多選題選項（包含正確答案 + 干擾項）
 */
function getNameOptionsFromNodes(
  virtualNodes: Map<string, VirtualNode>,
  correctNodeId: string,
  totalOptions: number
): string[] {
  const correctNode = virtualNodes.get(correctNodeId);
  if (!correctNode || !correctNode.name) return [];

  const options = [correctNode.name];
  const allNames: string[] = [];

  for (const [id, n] of virtualNodes) {
    if (id !== correctNodeId && n.name && n.name !== "未知" && !allNames.includes(n.name)) {
      allNames.push(n.name);
    }
  }

  // 隨機選取干擾項
  const shuffled = allNames.sort(() => Math.random() - 0.5);
  for (const name of shuffled) {
    if (options.length >= totalOptions) break;
    options.push(name);
  }

  // 隨機打亂最終順序
  return options.sort(() => Math.random() - 0.5);
}

/**
 * 比對答案是否一致
 */
export function compareAnswers(answer: any, treeValue: any, answerFormat: VerificationAnswerFormat): boolean {
  if (answerFormat === "yes-no") {
    // 統一布林值比對
    const a = answer === true || answer === "yes" || answer === "是";
    const t = treeValue === true || treeValue === "yes" || treeValue === "是";
    return a === t;
  }
  if (answerFormat === "number") {
    return Number(answer) === Number(treeValue);
  }
  if (answerFormat === "gender") {
    return String(answer).toLowerCase() === String(treeValue).toLowerCase();
  }
  // text / multiple-choice
  return String(answer).trim().toLowerCase() === String(treeValue).trim().toLowerCase();
}
