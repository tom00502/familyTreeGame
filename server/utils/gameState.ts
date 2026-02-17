// 遊戲狀態類型定義

export type Gender = "male" | "female";
export type RoomStatus = "idle" | "waiting" | "relationship-scan" | "in-game" | "finished";

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
  taskQueue: any[];
  completedTasks: any[];
  controllerId: string;
  originalOwnerId?: string;
  isLocked: boolean;
  startTime?: number;
  createdAt: number;
}

export interface GameState {
  rooms: Map<string, Room>;
}

// 全域遊戲狀態
export const gameState: GameState = {
  rooms: new Map(),
};
