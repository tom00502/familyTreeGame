// 遊戲狀態類型定義

export type Gender = "male" | "female" | "unknown";
export type RoomStatus = "idle" | "waiting" | "relationship-scan" | "data-filling" | "verification" | "finished";

// Phase 2 任務類型
export type TaskType = "node-naming" | "attribute-filling" | "upward-tracing" | "node-convergence" | "age-ordering" | "lateral-inquiry" | "downward-inquiry";
export type TaskPriority = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";
export type EfuDimension = "upward" | "lateral" | "downward" | "optional";

// 關係路徑邊類型
export type EdgeType = "P_f" | "P_m" | "P_any" | "C_m" | "C_f" | "C_any" | "S";

// ==================== Phase 2 虛擬節點定義 ====================

// 虛擬節點內部表示（比 MvftDisplayNode 更詳細）
export interface VirtualNode {
  id: string;
  name: string;
  gender: Gender;
  birthday?: Date; // YYYY-MM-DD 或空
  isPlayer: boolean;
  playerId?: string;
  isKeyNode: boolean;           // 是否在關鍵路徑上
  expansionType: "FULL" | "TERMINAL";  // 完全擴張 vs 終端擴張
  
  // EFU 完整化狀態
  efuStatus: {
    upward: boolean;      // 向上（父、母）是否完整
    lateral: boolean;     // 向側（配偶）是否完整
    downward: boolean;    // 向下（子女）是否完整
  };
  
  // 關係連結
  fatherId?: string;
  motherId?: string;
  spouseIds: string[];
  childrenIds: string[];
  
  createdAt: number;
  updatedAt: number;
}

// ==================== Phase 2 任務定義 ====================

// 節點命名任務
export interface NodeNamingTask {
  type: "node-naming";
  taskId: string;
  priority: TaskPriority;
  efuDimension: EfuDimension;
  targetNodeId: string;
  targetNodeLabel: string; // "爸爸", "爺爺" 等
  assignedPlayerId?: string;
  isLocked: boolean;
  createdAt: number;
  answer?: string;
  completedAt?: number;
}

// 屬性填充任務
export interface AttributeFillingTask {
  type: "attribute-filling";
  taskId: string;
  priority: TaskPriority;
  efuDimension: EfuDimension;
  targetNodeId: string;
  targetNodeName: string;
  attributeType: "gender" | "birthday" | "age";
  assignedPlayerId?: string;
  isLocked: boolean;
  createdAt: number;
  answer?: string | number;
  completedAt?: number;
}

// 向上追溯任務
export interface UpwardTracingTask {
  type: "upward-tracing";
  taskId: string;
  priority: TaskPriority;
  efuDimension: "upward";
  targetNodeId: string;
  targetNodeName: string;
  parentType: "father" | "mother";
  assignedPlayerId?: string;
  isLocked: boolean;
  createdAt: number;
  answer?: string; // 父/母的名字或節點 ID
  completedAt?: number;
}

// 節點匯聚任務
export interface NodeConvergenceTask {
  type: "node-convergence";
  taskId: string;
  priority: TaskPriority;
  efuDimension: EfuDimension;
  targetNodeId: string;
  targetNodeName: string;
  candidateNodeId: string;
  candidateNodeName: string;
  assignedPlayerId?: string;
  isLocked: boolean;
  createdAt: number;
  answer?: boolean; // true = 是同一人, false = 不是同一人
  completedAt?: number;
}

// 排序確認任務
export interface AgeOrderingTask {
  type: "age-ordering";
  taskId: string;
  priority: TaskPriority;
  efuDimension: EfuDimension;
  nodeIds: string[];
  nodeNames: string[];
  assignedPlayerId?: string;
  isLocked: boolean;
  createdAt: number;
  answer?: string[]; // 按年齡大小排序的節點 ID
  completedAt?: number;
}

// 配偶詢問任務（向側 EFU）
export interface LateralInquiryTask {
  type: "lateral-inquiry";
  taskId: string;
  priority: TaskPriority;
  efuDimension: "lateral";
  targetNodeId: string;
  targetNodeName: string;
  assignedPlayerId?: string;
  isLocked: boolean;
  createdAt: number;
  answer?: "yes" | "no" | "unknown"; // 是否有配偶
  completedAt?: number;
}

// 子女詢問任務（向下 EFU）
export interface DownwardInquiryTask {
  type: "downward-inquiry";
  taskId: string;
  priority: TaskPriority;
  efuDimension: "downward";
  targetNodeId: string;
  targetNodeName: string;
  knownChildrenCount: number; // 已知的子女數
  knownChildrenNames: string[]; // 已知的子女名字
  assignedPlayerId?: string;
  isLocked: boolean;
  createdAt: number;
  answer?: { hasMore: boolean; additionalCount?: number } | "no" | number; // 子女數或無
  completedAt?: number;
}

// 統一的任務類型
export type Phase2Task = NodeNamingTask | AttributeFillingTask | UpwardTracingTask | NodeConvergenceTask | AgeOrderingTask | LateralInquiryTask | DownwardInquiryTask;

// ==================== Phase 2 玩家狀態擴展 ====================

export interface Phase2PlayerState {
  playerId: string;
  currentTask?: Phase2Task;
  completedTasks: string[]; // taskId 列表
  skippedTasks: Map<string, number>; // taskId → skip count
  contributionScore: number; // 已完成任務數 / 總任務數
}

// 玩家提交的關係紀錄
export interface RelationshipRecord {
  subjectPlayerId: string;  // 宣告者 playerId
  objectPlayerId: string;   // 被宣告者 playerId
  subjectNodeId: string;
  objectNodeId: string;
  direction: string;        // father / mother / spouse / children / unknown
  title: string;            // 稱謂（如「爸爸」「表姐」）
  path: EdgeType[];         // 邏輯路徑序列
  roleLabels: string[];     // 中間虛擬節點標籤
}

// MVFT 可視化節點
export interface MvftDisplayNode {
  id: string;
  label: string;
  gender: "male" | "female" | "unknown";
  isPlayer: boolean;
  playerId?: string;
  isVirtual: boolean;
  birthday?: string;      // ISO 日期字串 (YYYY-MM-DD)，用於計算年齡
  isConfirmed?: boolean;   // 虛擬節點資料已確認（有名字）= true
}

// MVFT 可視化邊
export interface MvftDisplayEdge {
  from: string;
  to: string;
  type: "parent" | "spouse";
  label: string;
}

// MVFT 骨架資料（用於前端顯示）
export interface MvftData {
  nodes: MvftDisplayNode[];
  edges: MvftDisplayEdge[];
  generatedAt: number;
}

export interface Player {
  playerId: string;
  socketId: string;
  nodeId: string;
  name: string;
  gender: Gender;
  birthday: Date;
  score: number;
  isOffline: boolean;
  isObserver: boolean;
  joinedAt: number;
  questionQueue?: Array<{
    questionId: string;
    targetPlayerId: string;
    targetPlayerName: string;
    targetPlayerGender: Gender;
  }>;
  currentQuestionIndex?: number;
  answeredQuestions?: number;
}

export interface FamilyNode {
  id: string;
  isPlayer: boolean;
  info: {
    name: string;
    gender: Gender;
    birthday: Date;
  };
  relations: {
    spouses?: string[];
    children: string[];
    parents?: string[];
  };
  createdAt: number;
}

export interface FamilyTree {
  nodes: Map<string, FamilyNode>;
  rootNodes: string[];
  virtualNodes?: Map<string, VirtualNode>; // Phase 2: 虛擬節點存儲
}

// ==================== Phase 2 EFU 追踪 ====================

export interface EFUTracker {
  nodeId: string;
  nodeName: string;
  isKeyNode: boolean;
  completionStatus: {
    upward: boolean;
    lateral: boolean;
    downward: boolean;
  };
  remainingTasks: string[]; // 尚未完成的 taskId 列表
}

// ==================== Room 完整定義 ====================

export interface Room {
  roomId: string;
  roomName: string;
  status: RoomStatus;
  gameTime: number;
  players: Map<string, Player>;
  familyTree: FamilyTree;
  relationships: RelationshipRecord[];   // 玩家提交的關係紀錄
  mvft: MvftData | null;                 // 生成的骨架 MVFT
  
  // ========== Phase 2 任務系統 ==========
  taskQueue: Phase2Task[];               // 待派發任務隊列
  dispatchedTasks: Map<string, Phase2Task>; // 已派發任務 taskId → Task
  completedTasks: Phase2Task[];         // 已完成任務（保存用於計分）
  phase2State?: {
    efuTrackers: Map<string, EFUTracker>; // 各節點 EFU 完成度
    playerStates: Map<string, Phase2PlayerState>; // 各玩家在 Phase 2 的狀態
    taskDispatchIndex: number; // 任務派發指針
    lastDispatchTime: number;  // 最後派發時間（防止過度派發）
  };
  
  controllerId: string;
  originalOwnerId?: string;
  isLocked: boolean;
  startTime?: number;
  createdAt: number;
  // 旁觀系統
  spectators: Map<string, Spectator>;   // spectatorId → Spectator
  answerHistory: AnswerRecord[];        // 答題歷史（最多 50 筆）
}

// 旁觀者
export interface Spectator {
  spectatorId: string;
  socketId: string;
  name: string;
  joinedAt: number;
}

// 答題歷史筆記（供旁觀者看板顯示）
export interface AnswerRecord {
  timestamp: number;
  playerName: string;
  playerId: string;
  summary: string;            // 例如「確認「王大華」是爸爸」
  status: 'confirmed' | 'skipped';
}

export interface GameState {
  rooms: Map<string, Room>;
}

// 全域遊戲狀態
export const gameState: GameState = {
  rooms: new Map(),
};
