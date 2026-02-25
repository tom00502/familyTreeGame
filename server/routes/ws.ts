import type { Peer } from "crossws";
import { gameState } from "../utils/gameState";
import type { Room, Player, FamilyNode, RelationshipRecord, Spectator, AnswerRecord } from "../utils/gameState";
import {
  handleOwnerDisconnection,
  validatePlayerInfo,
  checkAllPlayersReady,
} from "../utils/roomManager";
import { titleToPath, buildSkeletonMvft } from "../utils/mvftBuilder";

interface GamePeer extends Peer {
  playerId?: string;
  roomId?: string;
  playerName?: string;
  isOwner?: boolean;
  isSpectatorPeer?: boolean;
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
          relationships: [],
          mvft: null,
          taskQueue: [],
          completedTasks: [],
          controllerId: peer.id,
          originalOwnerId: undefined,
          isLocked: false,
          createdAt: Date.now(),
          spectators: new Map(),
          answerHistory: [],
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

      // 旁觀者：直接進入看板（不需填姓名/性別/生日）
      if (data.type === "spectator:watch") {
        const { roomId } = data;
        console.log(`[WS] 收到 spectator:watch，roomId: ${roomId}`);
        
        const room = gameState.rooms.get(roomId);

        if (!room) {
          console.log(`[WS] ✗ 房間不存在: ${roomId}`);
          peer.send(JSON.stringify({ type: "error", message: "房間不存在" }));
          return;
        }

        console.log(`[WS] ✓ 房間存在: ${roomId}, isLocked: ${room.isLocked}, 玩家數: ${room.players.size}`);

        if (!room.isLocked) {
          // 遊戲尚未開始，導回加入頁
          console.log(`[WS] ⚠️  遊戲尚未開始 (isLocked=false)，發送 spectator:redirect`);
          peer.send(JSON.stringify({ type: "spectator:redirect", target: "join" }));
          return;
        }

        const spectatorId = crypto.randomUUID();
        const spectator: Spectator = {
          spectatorId,
          socketId: peer.id,
          name: "旁觀者",
          joinedAt: Date.now(),
        };
        room.spectators.set(spectatorId, spectator);

        gamePeer.playerId = spectatorId;
        gamePeer.roomId = roomId;
        gamePeer.playerName = "旁觀者";
        gamePeer.isSpectatorPeer = true;

        console.log(`[WS] 發送 spectator:joined`);
        peer.send(JSON.stringify({
          type: "spectator:joined",
          spectatorId,
        }));

        // 傳送完整即時狀態
        const syncData = buildSpectatorSync(room);
        console.log(`[WS] 發送 spectator:sync: ${syncData.players.length} 玩家, ${syncData.answerHistory.length} 答題紀錄, mvft=${!!syncData.mvft}`);
        peer.send(JSON.stringify(syncData));

        console.log(`[Room] ✓ 旁觀者加入: ${roomId}`);
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
          const spectator: Spectator = {
            spectatorId,
            socketId: peer.id,
            name,
            joinedAt: Date.now(),
          };
          room.spectators.set(spectatorId, spectator);

          gamePeer.playerId = spectatorId;
          gamePeer.roomId = roomId;
          gamePeer.playerName = name;
          gamePeer.isSpectatorPeer = true;

          // 告知此連線已成為旁觀者
          peer.send(
            JSON.stringify({
              type: "spectator:joined",
              spectatorId,
              message: "遊戲進行中，您以旁觀者身份加入",
            })
          );

          // 同步完整房間狀態給旁觀者
          peer.send(JSON.stringify(buildSpectatorSync(room)));

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
              isOwner: gamePeer.isOwner,
            })
          );
          
          console.log(`[Room] 玩家加入: ${name} -> ${roomId} (房主: ${gamePeer.isOwner})`);
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
        
        // 生成第一階段問題並發送
        generateAndSendQuestions(room);
      }
      
      // 回答關係問題
      if (data.type === "relationship_answer") {
        const { questionId, answer } = data;
        const { roomId, playerId } = gamePeer;
        
        if (!roomId || !playerId) return;
        
        const room = gameState.rooms.get(roomId);
        if (!room) return;
        
        const player = room.players.get(playerId);
        if (!player || !player.questionQueue) return;
        
        // 驗證問題 ID
        const currentQuestion = player.questionQueue[player.currentQuestionIndex || 0];
        if (currentQuestion?.questionId !== questionId) {
          console.error(`[Question] 問題 ID 不匹配`);
          return;
        }
        
        console.log(`[Question] 玩家 ${gamePeer.playerName} 回答問題 ${player.currentQuestionIndex! + 1}/${player.questionQueue.length}:`, answer);

        // ── 推送答題紀錄給旁觀者 ──────────────────────────────
        const answeredCount = (player.answeredQuestions || 0) + 1;
        const answerSummary = (answer.relation && answer.relation !== '跳過')
          ? `確認「${currentQuestion.targetPlayerName}」是${answer.relation}`
          : `跳過「${currentQuestion.targetPlayerName}」的關係問題`;
        const answerStatus = (answer.relation && answer.relation !== '跳過') ? 'confirmed' : 'skipped';
        
        const record: AnswerRecord = {
          timestamp: Date.now(),
          playerName: player.name,
          playerId: player.playerId,
          summary: answerSummary,
          status: answerStatus,
        };
        room.answerHistory.unshift(record);
        if (room.answerHistory.length > 50) room.answerHistory.pop();

        broadcastToSpectators(roomId, { type: 'spectator:answer_submitted', ...record });
        broadcastToSpectators(roomId, buildSpectatorPlayerStatus(player, answeredCount));
        
        // ── 建立關係紀錄並儲存至 room.relationships ──
        if (answer.relation && answer.relation !== '跳過' && answer.direction !== 'unknown') {
          const pathDef = titleToPath(answer.relation);
          if (pathDef) {
            const targetPlayer = Array.from(room.players.values()).find(
              p => p.playerId === currentQuestion.targetPlayerId
            );
            if (targetPlayer) {
              const record: RelationshipRecord = {
                subjectPlayerId: playerId,
                objectPlayerId: currentQuestion.targetPlayerId,
                subjectNodeId: player.nodeId,
                objectNodeId: targetPlayer.nodeId,
                direction: answer.direction || '',
                title: answer.relation,
                path: pathDef.path,
                roleLabels: pathDef.roleLabels ?? [],
              };
              room.relationships.push(record);
              console.log(`[MVFT] 紀錄關係: ${player.name} → ${targetPlayer.name} (${answer.relation}) path=${pathDef.path.join(',')}}`);
            }
          }
        }
        
        player.answeredQuestions = (player.answeredQuestions || 0) + 1;
        player.currentQuestionIndex = (player.currentQuestionIndex || 0) + 1;
        
        // 廣播關係已確認（只發給答題者）
        const peer = Array.from(connections.values()).find(
          p => (p as GamePeer).playerId === playerId
        );
        
        if (peer) {
          peer.send(JSON.stringify({
            type: "relationship_confirmed",
            questionId,
            answer,
          }));
        }
        
        // 發送下一題
        setTimeout(() => {
          sendNextQuestion(room, player);
        }, 500); // 給前端一點時間處理
      }
      
      // 跳過問題
      if (data.type === "relationship_skip") {
        const { questionId } = data;
        const { roomId, playerId } = gamePeer;
        
        if (!roomId || !playerId) return;
        
        const room = gameState.rooms.get(roomId);
        if (!room) return;
        
        const player = room.players.get(playerId);
        if (!player || !player.questionQueue) return;
        
        // 驗證問題 ID
        const currentQuestion = player.questionQueue[player.currentQuestionIndex || 0];
        if (currentQuestion?.questionId !== questionId) {
          console.error(`[Question] 問題 ID 不匹配`);
          return;
        }
        
        console.log(`[Question] 玩家 ${gamePeer.playerName} 跳過問題 ${player.currentQuestionIndex! + 1}/${player.questionQueue.length}`);

        // ── 推送跳過紀錄給旁觀者 ─────────────────────────────
        const skipCount = (player.answeredQuestions || 0) + 1;
        const skipRecord: AnswerRecord = {
          timestamp: Date.now(),
          playerName: player.name,
          playerId: player.playerId,
          summary: `跳過「${currentQuestion.targetPlayerName}」的關係問題`,
          status: 'skipped',
        };
        room.answerHistory.unshift(skipRecord);
        if (room.answerHistory.length > 50) room.answerHistory.pop();
        broadcastToSpectators(roomId, { type: 'spectator:answer_submitted', ...skipRecord });
        broadcastToSpectators(roomId, buildSpectatorPlayerStatus(player, skipCount));

        // 記錄跳過
        player.answeredQuestions = (player.answeredQuestions || 0) + 1;
        player.currentQuestionIndex = (player.currentQuestionIndex || 0) + 1;
        
        // 通知前端已確認跳過
        const peer = Array.from(connections.values()).find(
          p => (p as GamePeer).playerId === playerId
        );
        
        if (peer) {
          peer.send(JSON.stringify({
            type: "relationship_confirmed",
            questionId,
            answer: { relation: "跳過" },
          }));
        }
        
        // 發送下一題
        setTimeout(() => {
          sendNextQuestion(room, player);
        }, 500); // 給前端一點時間處理
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
        // 旁觀者離線 → 從 spectators map 移除
        if (gamePeer.isSpectatorPeer) {
          room.spectators.delete(gamePeer.playerId);
          console.log(`[Room] 旁觀者離線: ${gamePeer.playerName}`);
          connections.delete(peer.id);
          return;
        }

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

          // 通知旁觀者：玩家離線
          broadcastToSpectators(gamePeer.roomId, {
            ...buildSpectatorPlayerStatus(player, player.answeredQuestions || 0),
            isOffline: true,
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

// ── 旁觀者相關工具函式 ────────────────────────────────────────────

/** 廣播訊息給房間內所有旁觀者 */
function broadcastToSpectators(roomId: string, message: any) {
  const room = gameState.rooms.get(roomId);
  if (!room) return;
  const messageStr = JSON.stringify(message);
  room.spectators.forEach((spectator) => {
    const conn = connections.get(spectator.socketId);
    if (conn) conn.send(messageStr);
  });
}

/** 建立給旁觀者的完整初始同步資料 */
function buildSpectatorSync(room: Room) {
  const players = Array.from(room.players.values())
    .filter(p => !p.isObserver)
    .map(p => {
      const status = buildSpectatorPlayerStatus(p, p.answeredQuestions || 0);
      // 移除 type 字段，因為 players 陣列本身就在 spectator:sync 訊息中
      const { type, ...playerData } = status;
      return playerData;
    });

  return {
    type: 'spectator:sync',
    roomName: room.roomName,
    roomStatus: room.status,
    players,
    answerHistory: room.answerHistory,
    mvft: room.mvft,
  };
}

/** 建立單一玩家的旁觀者狀態物件 */
function buildSpectatorPlayerStatus(player: Player, answeredCount: number) {
  const total = player.questionQueue?.length ?? 0;
  const nextQ = player.questionQueue && player.currentQuestionIndex !== undefined
    ? player.questionQueue[player.currentQuestionIndex]
    : null;
  const currentQuestionSummary = nextQ
    ? `確認與「${nextQ.targetPlayerName}」的關係`
    : null;
  return {
    type: 'spectator:player_status',
    playerId: player.playerId,
    name: player.name,
    isOffline: player.isOffline,
    answeredCount,
    totalQuestions: total,
    currentQuestionSummary,
  };
}

// ─────────────────────────────────────────────────────────────────

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

// 生成並發送第一階段問題
function generateAndSendQuestions(room: Room) {
  const players = Array.from(room.players.values()).filter(p => !p.isOffline && !p.isObserver);
  
  // 為每個玩家生成問題隊列
  for (const player of players) {
    player.questionQueue = [];
    player.currentQuestionIndex = 0;
    player.answeredQuestions = 0;
    
    let targetPlayers: Player[];
    
    if (players.length < 4) {
      // 少於4人：詢問所有其他玩家
      targetPlayers = players.filter(p => p.playerId !== player.playerId);
    } else {
      // ≥ 4人：詢問3位其他玩家
      const otherPlayers = players.filter(p => p.playerId !== player.playerId);
      targetPlayers = selectRandomPlayers(otherPlayers, 3);
    }
    
    // 建立問題隊列
    for (const targetPlayer of targetPlayers) {
      player.questionQueue.push({
        questionId: crypto.randomUUID(),
        targetPlayerId: targetPlayer.playerId,
        targetPlayerName: targetPlayer.name,
        targetPlayerGender: targetPlayer.gender,
      });
    }
    
    // 發送第一題
    sendNextQuestion(room, player);
  }
  
  console.log(`[Question] 已為 ${players.length} 位玩家生成問題隊列`);
}

// 隨機選擇指定數量的玩家
function selectRandomPlayers(players: Player[], count: number): Player[] {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, players.length));
}

// 發送下一題給玩家
function sendNextQuestion(room: Room, player: Player) {
  if (!player.questionQueue || player.currentQuestionIndex === undefined) {
    console.error(`[Question] 玩家 ${player.name} 沒有問題隊列`);
    return;
  }
  
  // 檢查是否還有問題
  if (player.currentQuestionIndex >= player.questionQueue.length) {
    console.log(`[Question] 玩家 ${player.name} 已完成所有問題 (${player.answeredQuestions}/${player.questionQueue.length})`);
    
    // 通知旁觀者：玩家已完成所有問題（currentQuestionSummary = null）
    broadcastToSpectators(room.roomId, buildSpectatorPlayerStatus(player, player.answeredQuestions || 0));

    // 檢查是否所有玩家都完成了
    checkAllQuestionsCompleted(room);
    return;
  }
  
  const question = player.questionQueue[player.currentQuestionIndex];
  const peer = Array.from(connections.values()).find(
    p => (p as GamePeer).playerId === player.playerId
  );
  
  if (peer) {
    peer.send(JSON.stringify({
      type: "relationship_question",
      questionId: question.questionId,
      askedPlayerId: player.playerId,
      targetPlayerId: question.targetPlayerId,
      targetPlayerName: question.targetPlayerName,
      targetPlayerGender: question.targetPlayerGender,
    }));
    
    console.log(`[Question] 發送問題 ${player.currentQuestionIndex + 1}/${player.questionQueue.length} 給 ${player.name}: ${question.targetPlayerName} 是你的誰？`);
  }

  // 通知旁觀者：玩家目前作答行動測更新
  if (room) {
    broadcastToSpectators(room.roomId, buildSpectatorPlayerStatus(player, player.answeredQuestions || 0));
  }
}

// 檢查是否所有玩家都完成問題
function checkAllQuestionsCompleted(room: Room) {
  const activePlayers = Array.from(room.players.values()).filter(p => !p.isOffline && !p.isObserver);
  
  const allCompleted = activePlayers.every(player => {
    if (!player.questionQueue) return false;
    return player.answeredQuestions === player.questionQueue.length;
  });
  
  if (allCompleted) {
    console.log(`[Question] 所有玩家已完成關係掃描階段`);
    console.log(`[MVFT] 共收集 ${room.relationships.length} 筆關係紀錄，開始生成骨架 MVFT...`);
    
    // ── 生成骨架 MVFT ───────────────────────────────────────────
    const playerInfoList = Array.from(room.players.values()
    ).filter(p => !p.isObserver).map(p => ({
      playerId: p.playerId,
      nodeId: p.nodeId,
      name: p.name,
      gender: p.gender,
    }));
    
    const mvft = buildSkeletonMvft(room.relationships, playerInfoList);
    room.mvft = mvft;
    
    console.log(`[MVFT] 生成完成：${mvft.nodes.length} 個節點，${mvft.edges.length} 條邊`);
    
    // 進入下一階段
    room.status = "in-game";
    
    broadcastToRoom(room.roomId, "", {
      type: "stage_completed",
      stage: "relationship-scan",
      nextStage: "in-game",
      mvft,  // 附帶 MVFT 資料
    });

    // 通知旁觀者：族譜醫架就緒
    broadcastToSpectators(room.roomId, {
      type: 'spectator:tree_updated',
      mvft,
    });
  }
}
