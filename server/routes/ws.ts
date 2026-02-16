import type { Peer } from "crossws";
import { gameState } from "../utils/gameState";
import type { Room, Player, FamilyNode } from "../utils/gameState";
import {
  handleOwnerDisconnection,
  validatePlayerInfo,
  checkAllPlayersReady,
} from "../utils/roomManager";

interface GamePeer extends Peer {
  playerId?: string;
  roomId?: string;
  playerName?: string;
  isOwner?: boolean;
}

const connections = new Map<string, GamePeer>();

export default defineWebSocketHandler({
  open(peer) {
    console.log(`[WS] 連線建立: ${peer.id}`);
    connections.set(peer.id, peer as GamePeer);
  },

  message(peer, message) {
    try {
      const data = JSON.parse(message.text());
      const gamePeer = peer as GamePeer;

      // 建立房間
      if (data.type === "room:create") {
        const roomId = crypto.randomUUID().substring(0, 8).toUpperCase();
        const room: Room = {
          roomId,
          roomName: data.name,
          status: "waiting",
          gameTime: data.gameTime,
          players: new Map(),
          familyTree: { nodes: new Map(), rootNodes: [] },
          taskQueue: [],
          completedTasks: [],
          controllerId: peer.id,
          originalOwnerId: undefined,
          isLocked: false,
          createdAt: Date.now(),
        };

        gameState.rooms.set(roomId, room);
        gamePeer.roomId = roomId;
        gamePeer.isOwner = true;

        const shareLink = `${process.env.BASE_URL || "http://localhost:3000"}/room/${roomId}`;
        
        peer.send(
          JSON.stringify({
            type: "room:created",
            roomId,
            shareLink,
          })
        );
        
        console.log(`[Room] 建立房間: ${roomId} (${data.name})`);
      }

      // 成員正在輸入
      if (data.type === "member:typing") {
        const room = gameState.rooms.get(data.roomId);
        if (room) {
          broadcastToRoom(data.roomId, peer.id, {
            type: "member:typing_notify",
            timestamp: Date.now(),
          });
        }
      }

      // 成員加入
      if (data.type === "member:join") {
        const { roomId, playerId, name, gender, birthday } = data;
        const room = gameState.rooms.get(roomId);

        if (!room) {
          peer.send(
            JSON.stringify({
              type: "error",
              message: "房間不存在",
            })
          );
          return;
        }

        // 驗證資料
        const validation = validatePlayerInfo({ name, gender, birthday });
        if (!validation.valid) {
          peer.send(
            JSON.stringify({
              type: "error",
              message: validation.error,
            })
          );
          return;
        }

        // 檢查房間是否鎖定（遊戲進行中）
        if (room.isLocked) {
          // 設為旁觀者
          const spectatorId = crypto.randomUUID();
          gamePeer.playerId = spectatorId;
          gamePeer.roomId = roomId;
          gamePeer.playerName = name;

          peer.send(
            JSON.stringify({
              type: "spectator:joined",
              spectatorId,
              message: "遊戲進行中,您以旁觀者身份加入",
            })
          );

          broadcastToRoom(roomId, peer.id, {
            type: "spectator:joined",
            spectatorId,
            name,
          });
          
          console.log(`[Room] 旁觀者加入: ${name} -> ${roomId}`);
          return;
        }

        // 正常加入或重連
        let player: Player;

        if (playerId && room.players.has(playerId)) {
          // 重連玩家
          player = room.players.get(playerId)!;
          player.socketId = peer.id;
          player.isOffline = false;
          
          console.log(`[Room] 玩家重連: ${name} (${playerId})`);
        } else {
          // 新玩家
          const newPlayerId = crypto.randomUUID();
          const nodeId = crypto.randomUUID();

          player = {
            playerId: newPlayerId,
            socketId: peer.id,
            nodeId,
            name,
            gender: gender as "male" | "female",
            birthday: new Date(birthday),
            score: 0,
            isOffline: false,
            isObserver: false,
            joinedAt: Date.now(),
          };

          room.players.set(newPlayerId, player);

          // 如果是第一位玩家,設為房主
          if (room.players.size === 1) {
            room.controllerId = peer.id;
            room.originalOwnerId = newPlayerId;
            gamePeer.isOwner = true;
          }

          // 創建對應的族譜節點
          const node: FamilyNode = {
            id: nodeId,
            isPlayer: true,
            info: { name, gender: gender as "male" | "female", birthday: new Date(birthday) },
            relations: { children: [] },
            createdAt: Date.now(),
          };

          room.familyTree.nodes.set(nodeId, node);

          peer.send(
            JSON.stringify({
              type: "player_registered",
              playerId: newPlayerId,
              nodeId,
            })
          );
          
          console.log(`[Room] 玩家加入: ${name} -> ${roomId}`);
        }

        gamePeer.playerId = player.playerId;
        gamePeer.roomId = roomId;
        gamePeer.playerName = name;
        gamePeer.isOwner = room.controllerId === peer.id;

        // 廣播成員加入
        broadcastToRoom(roomId, "", {
          type: "member:joined",
          playerId: player.playerId,
          name: player.name,
          gender: player.gender,
          isOwner: gamePeer.isOwner,
        });

        // 同步房間狀態
        syncRoomState(room);
      }

      // 開始遊戲
      if (data.type === "game:start") {
        const { roomId } = data;
        const room = gameState.rooms.get(roomId);
        
        if (!room) {
          peer.send(
            JSON.stringify({
              type: "error",
              message: "房間不存在",
            })
          );
          return;
        }
        
        if (room.controllerId !== peer.id) {
          peer.send(
            JSON.stringify({
              type: "error",
              message: "只有房主可以開始遊戲",
            })
          );
          return;
        }

        if (!checkAllPlayersReady(room)) {
          peer.send(
            JSON.stringify({
              type: "error",
              message: "至少需要 2 位玩家才能開始遊戲",
            })
          );
          return;
        }

        room.status = "relationship-scan";
        room.isLocked = true;
        room.startTime = Date.now();

        broadcastToRoom(roomId, "", {
          type: "game:started",
          startTime: room.startTime,
          phase: room.status,
        });
        
        console.log(`[Room] 遊戲開始: ${roomId}`);
      }

      // 重連請求
      if (data.type === "reconnect") {
        const { roomId, playerId } = data;
        const room = gameState.rooms.get(roomId);
        
        if (!room) {
          peer.send(
            JSON.stringify({
              type: "error",
              message: "房間不存在",
            })
          );
          return;
        }

        const player = room.players.get(playerId);
        if (player) {
          player.socketId = peer.id;
          player.isOffline = false;
          gamePeer.playerId = playerId;
          gamePeer.roomId = roomId;
          gamePeer.playerName = player.name;
          gamePeer.isOwner = room.controllerId === peer.id;

          // 恢復房主權限
          if (playerId === room.originalOwnerId) {
            room.controllerId = peer.id;
            gamePeer.isOwner = true;

            peer.send(
              JSON.stringify({
                type: "owner_restored",
                roomState: getCurrentRoomState(room),
              })
            );
          } else {
            peer.send(
              JSON.stringify({
                type: "reconnected",
                roomState: getCurrentRoomState(room),
              })
            );
          }

          syncRoomState(room);
          console.log(`[Room] 重連成功: ${player.name} (${playerId})`);
        }
      }

    } catch (error) {
      console.error("[WS] 訊息處理錯誤:", error);
      peer.send(
        JSON.stringify({
          type: "error",
          message: "伺服器處理錯誤",
        })
      );
    }
  },

  close(peer) {
    console.log(`[WS] 連線關閉: ${peer.id}`);
    const gamePeer = peer as GamePeer;

    if (gamePeer.roomId && gamePeer.playerId) {
      const room = gameState.rooms.get(gamePeer.roomId);
      if (room) {
        const player = room.players.get(gamePeer.playerId);
        if (player) {
          player.isOffline = true;

          // 如果是房主離線
          if (gamePeer.isOwner && room.status === "waiting") {
            const ownerChange = handleOwnerDisconnection(room, gamePeer.playerId);
            
            if (ownerChange) {
              broadcastToRoom(gamePeer.roomId, "", {
                type: "owner_changed",
                newOwnerId: ownerChange.newOwnerId,
                newOwnerName: ownerChange.newOwnerName,
              });
            }
          }

          // 通知其他玩家
          broadcastToRoom(gamePeer.roomId, "", {
            type: "player_offline",
            playerId: player.playerId,
            name: player.name,
          });

          syncRoomState(room);
          console.log(`[Room] 玩家離線: ${player.name}`);
        }
      }
    }

    connections.delete(peer.id);
  },

  error(peer, error) {
    console.error(`[WS] 錯誤 (${peer.id}):`, error);
  },
});

// 輔助函數：廣播訊息給房間內所有玩家（排除指定 socketId）
function broadcastToRoom(roomId: string, excludeSocketId: string, message: any) {
  const room = gameState.rooms.get(roomId);
  if (!room) return;

  const messageStr = JSON.stringify(message);

  room.players.forEach((player) => {
    if (player.socketId !== excludeSocketId && !player.isOffline) {
      const peerConnection = connections.get(player.socketId);
      if (peerConnection) {
        peerConnection.send(messageStr);
      }
    }
  });
}

// 同步房間狀態
function syncRoomState(room: Room) {
  const players = Array.from(room.players.values()).map((p) => ({
    playerId: p.playerId,
    name: p.name,
    gender: p.gender,
    score: p.score,
    isOffline: p.isOffline,
    isObserver: p.isObserver,
  }));

  const remainingTime = room.startTime
    ? Math.max(
        0,
        room.gameTime - Math.floor((Date.now() - room.startTime) / 1000)
      )
    : room.gameTime;

  const state = {
    type: "sync:state",
    roomId: room.roomId,
    roomName: room.roomName,
    status: room.status,
    gameTime: room.gameTime,
    remainingTime,
    players,
    isLocked: room.isLocked,
  };

  broadcastToRoom(room.roomId, "", state);
}

// 取得當前房間狀態
function getCurrentRoomState(room: Room) {
  const players = Array.from(room.players.values()).map((p) => ({
    playerId: p.playerId,
    name: p.name,
    gender: p.gender,
    score: p.score,
    isOffline: p.isOffline,
    isObserver: p.isObserver,
  }));

  const remainingTime = room.startTime
    ? Math.max(
        0,
        room.gameTime - Math.floor((Date.now() - room.startTime) / 1000)
      )
    : room.gameTime;

  return {
    roomId: room.roomId,
    roomName: room.roomName,
    status: room.status,
    gameTime: room.gameTime,
    remainingTime,
    players,
    isLocked: room.isLocked,
  };
}
