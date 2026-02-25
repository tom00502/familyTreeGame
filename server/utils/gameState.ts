// 遊戲狀態類型定義

export type Gender = "male" | "female";
export type RoomStatus = "idle" | "waiting" | "relationship-scan" | "in-game" | "finished";

// 關係路徑邊類型
export type EdgeType = "P_f" | "P_m" | "P_any" | "C_m" | "C_f" | "C_any" | "S";

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
}

export interface Room {
  roomId: string;
  roomName: string;
  status: RoomStatus;
  gameTime: number;
  players: Map<string, Player>;
  familyTree: FamilyTree;
  relationships: RelationshipRecord[];   // 玩家提交的關係紀錄
  mvft: MvftData | null;                 // 生成的骨架 MVFT
  taskQueue: any[];
  completedTasks: any[];
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
