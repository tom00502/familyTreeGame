import type { Peer } from "crossws";
import { gameState } from "../utils/gameState";
import type { Room, Player, FamilyNode, RelationshipRecord, Spectator, AnswerRecord, Phase2Task, TaskPriority } from "../utils/gameState";
import {
  handleOwnerDisconnection,
  validatePlayerInfo,
  checkAllPlayersReady,
} from "../utils/roomManager";
import { titleToPath, buildSkeletonMvft } from "../utils/mvftBuilder";
import { instantiateVirtualNodes, generatePhase2Tasks, initializeEFUTrackers, selectNextTaskToDispatch, selectNextTaskForPlayer, updateTaskLabelsAfterNaming, isTaskStillNeeded, createDynamicSpouseNode, createDynamicChildrenNodes, detectSameNameNodes, mergeVirtualNodes } from "../utils/phase2TaskGenerator";
import { checkEFUCompletion } from "../utils/phase2EFUChecker";

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
    handleMessage(peer, message).catch(err => {
      console.error('[WS] 处理消息错误:', err);
    });
  },

  close(peer) {
    console.log(`[WS] 連線關閉: ${peer.id}`);
    connections.delete(peer.id);
  },
});

// ════════════════════════════════════════════════════════════════════
// 異步消息處理函數
// ════════════════════════════════════════════════════════════════════

async function handleMessage(peer: any, message: any) {
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
          familyTree: { nodes: new Map(), rootNodes: [], virtualNodes: new Map() },
          relationships: [],
          mvft: null,
          taskQueue: [],
          dispatchedTasks: new Map(),
          completedTasks: [],
          phase2State: undefined,
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
        setTimeout(async () => {
          await sendNextQuestion(room, player);
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
        setTimeout(async () => {
          await sendNextQuestion(room, player);
        }, 500); // 給前端一點時間處理
      }

      // ──────────────────────────────────────────────
      // Phase 2: 資料填充事件處理
      // ──────────────────────────────────────────────

      if (data.type === "data_filling:answer") {
        const { taskId, answer } = data;
        const { roomId, playerId } = gamePeer;
        
        if (!roomId || !playerId) return;
        
        const room = gameState.rooms.get(roomId);
        if (!room || room.status !== "data-filling") return;
        
        const task = room.dispatchedTasks.get(taskId);
        if (!task || task.assignedPlayerId !== playerId) {
          console.error(`[Phase 2] 任務 ID 或所有者不匹配: ${taskId}`);
          return;
        }
        
        const player = room.players.get(playerId);
        if (!player) return;
        
        console.log(`[Phase 2] 玩家 ${player.name} 完成任務 ${taskId}`);
        
        // 1. 更新虛擬節點信息（規則 4：答案即時回填骨架族譜）
        const targetNodeId = (task as any).targetNodeId;
        let updateType: string = '';
        // 保存原始標籤，用於旁觀者摘要（命名任務會更新標籤，需先記錄）
        const originalLabel = (task as any).targetNodeLabel || (task as any).targetNodeName || '';
        if (targetNodeId) {
          const vnode = room.familyTree.virtualNodes?.get(targetNodeId);
          if (vnode) {
            if (task.type === "node-naming" && typeof answer === "string") {
              vnode.name = answer;
              updateType = 'name';
              // 規則 5：姓名優先 — 命名後更新所有引用此節點的待派任務標籤
              updateTaskLabelsAfterNaming(
                targetNodeId,
                answer,
                room.taskQueue,
                room.dispatchedTasks,
                room.players,
                room.familyTree.virtualNodes
              );
              console.log(`[Phase 2] 節點 ${targetNodeId} 命名為「${answer}」，已更新後續任務標籤`);
              
              // ★ 同名節點偵測：檢查是否有其他節點同名，自動產生匯聚確認任務
              const convergenceTasks = detectSameNameNodes(
                targetNodeId,
                answer,
                room.familyTree.virtualNodes!,
                room.players
              );
              if (convergenceTasks.length > 0) {
                // 匯聚任務優先插入隊列頭部
                room.taskQueue.unshift(...convergenceTasks);
                console.log(`[Phase 2] 偵測到 ${convergenceTasks.length} 個同名節點「${answer}」，產生匯聚確認任務`);
              }
            } else if (task.type === "attribute-filling" && "attributeType" in task) {
              if (task.attributeType === "gender" && (answer === "male" || answer === "female")) {
                vnode.gender = answer;
                vnode.efuStatus.upward = true; // 確認性別即視為向上完整
                updateType = 'gender';
              } else if (task.attributeType === "birthday") {
                vnode.birthday = new Date(answer as string);
                updateType = 'birthday';
              }
            } else if (task.type === "upward-tracing" && "parentType" in task) {
              if ((task as any).parentType === "father") {
                vnode.fatherId = answer as string;
              } else if ((task as any).parentType === "mother") {
                vnode.motherId = answer as string;
              }
              vnode.efuStatus.upward = true;
              updateType = 'parent';
            } else if (task.type === "node-convergence") {
              // ★ 節點匯聚：玩家確認兩個同名節點是否為同一人
              const candidateNodeId = (task as any).candidateNodeId;
              if (answer === true || answer === 'yes') {
                // 確認為同一人：合併節點
                mergeVirtualNodes(targetNodeId, candidateNodeId, room.familyTree.virtualNodes!);
                updateType = 'merge';
                console.log(`[Phase 2] 節點匯聚：${candidateNodeId} 合併至 ${targetNodeId}`);
                
                // 移除所有引用被合併節點 ID 的任務
                room.taskQueue = room.taskQueue.filter(t => {
                  const tid = (t as any).targetNodeId;
                  const cid = (t as any).candidateNodeId;
                  return tid !== candidateNodeId && cid !== candidateNodeId;
                });
              } else {
                // 確認不是同一人：維持兩個節點
                updateType = 'convergence_rejected';
                console.log(`[Phase 2] 節點匯聚拒絕：${targetNodeId} 與 ${candidateNodeId} 非同一人`);
              }
            } else if (task.type === "lateral-inquiry") {
              // 配偶詢問：玩家回答是否有配偶
              if (answer === "yes") {
                // 動態建立配偶虛擬節點和相應任務
                const { spouseNode, tasks: newTasks } = createDynamicSpouseNode(
                  room, targetNodeId, room.familyTree.virtualNodes!
                );
                // 將新任務加入任務隊列
                room.taskQueue.push(...newTasks);
                vnode.efuStatus.lateral = true;
                updateType = 'spouse_confirmed';
                console.log(`[Phase 2] 節點 ${targetNodeId} 確認有配偶，建立配偶節點 ${spouseNode.id}`);
              } else if (answer === "no") {
                // 確認無配偶
                vnode.efuStatus.lateral = true;
                updateType = 'spouse_none';
                console.log(`[Phase 2] 節點 ${targetNodeId} 確認無配偶`);
              }
              // "unknown" / 跳過的情況在 skip handler 處理
            } else if (task.type === "downward-inquiry") {
              // 子女詢問：玩家回答有幾個子女
              if (typeof answer === "number" && answer > 0) {
                // 動態建立子女虛擬節點和相應任務
                const { childNodes, tasks: newTasks } = createDynamicChildrenNodes(
                  room, targetNodeId, answer, room.familyTree.virtualNodes!
                );
                // 將新任務加入任務隊列
                room.taskQueue.push(...newTasks);
                vnode.efuStatus.downward = true;
                updateType = 'children_confirmed';
                console.log(`[Phase 2] 節點 ${targetNodeId} 確認有 ${answer} 個子女，建立 ${childNodes.length} 個子女節點`);
              } else if (answer === "no" || answer === 0) {
                // 確認無子女
                vnode.efuStatus.downward = true;
                updateType = 'children_none';
                console.log(`[Phase 2] 節點 ${targetNodeId} 確認無子女`);
              } else if (typeof answer === "object" && answer !== null && 'hasMore' in answer) {
                // 有額外子女
                const additionalCount = (answer as any).additionalCount || 0;
                if (additionalCount > 0) {
                  const { childNodes, tasks: newTasks } = createDynamicChildrenNodes(
                    room, targetNodeId, additionalCount, room.familyTree.virtualNodes!
                  );
                  room.taskQueue.push(...newTasks);
                }
                vnode.efuStatus.downward = true;
                updateType = 'children_confirmed';
              }
            }
            vnode.updatedAt = Date.now();
          }
        }
        
        // 2. 標記任務完成
        task.answer = answer;
        task.completedAt = Date.now();
        room.completedTasks.push(task);
        room.dispatchedTasks.delete(taskId);
        
        // 2.5 規則 3：資訊去重 — 從任務隊列移除已不需要的任務
        room.taskQueue = room.taskQueue.filter(t => 
          isTaskStillNeeded(t, room.familyTree.virtualNodes ?? new Map())
        );
        
        // 3. 更新玩家分數
        const playerState = room.phase2State?.playerStates.get(playerId);
        if (playerState) {
          playerState.completedTasks.push(taskId);
          playerState.contributionScore = playerState.completedTasks.length / (room.taskQueue.length + room.completedTasks.length);
        }
        
        // 4. 規則 4：重建 MVFT 並推送給旁觀者即時更新族譜
        // 使用原始標籤（命名前的關係描述），而非已更新後的姓名
        const answerSummaryText = task.type === 'node-naming'
          ? `為「${originalLabel}」命名為「${answer}」`
          : task.type === 'attribute-filling'
            ? `填寫「${(task as any).targetNodeName}」的${(task as any).attributeType === 'gender' ? '性別' : '生日'}`
            : task.type === 'upward-tracing'
              ? `追溯「${(task as any).targetNodeName}」的${(task as any).parentType === 'father' ? '父親' : '母親'}`
              : task.type === 'lateral-inquiry'
                ? answer === 'yes' ? `確認「${originalLabel}」有配偶` : `確認「${originalLabel}」無配偶`
                : task.type === 'downward-inquiry'
                  ? (typeof answer === 'number' && answer > 0) ? `確認「${originalLabel}」有 ${answer} 個子女` : `確認「${originalLabel}」無子女`
                  : `完成任務 ${taskId}`;

        const answerRecord: AnswerRecord = {
          timestamp: Date.now(),
          playerName: player.name,
          playerId,
          summary: answerSummaryText,
          status: "confirmed",
        };
        room.answerHistory.unshift(answerRecord);
        if (room.answerHistory.length > 50) room.answerHistory.pop();
        broadcastToSpectators(roomId, { type: "spectator:answer_submitted", ...answerRecord });
        
        // 4.5 重建 MVFT 顯示資料並通知旁觀者
        try {
          const playerInfoList = Array.from(room.players.values())
            .filter(p => !p.isObserver)
            .map(p => ({ playerId: p.playerId, nodeId: p.nodeId, name: p.name, gender: p.gender, birthday: p.birthday }));
          const updatedMvft = buildSkeletonMvft(room.relationships, playerInfoList, room.familyTree.virtualNodes);
          // virtualNodes 已在 buildSkeletonMvft 第五步處理，不需要再次更新標籤
          room.mvft = updatedMvft;
          broadcastToSpectators(roomId, {
            type: "spectator:tree_updated",
            mvft: updatedMvft,
            updatedNodeId: targetNodeId,
            updateType,
          });
          console.log(`[Phase 2] MVFT 已更新並通知旁觀者 (${updateType}: ${targetNodeId})`);
        } catch (err) {
          console.error(`[Phase 2] 重建 MVFT 失敗:`, err);
        }
        
        // 5. 檢查 EFU 完成度
        const isEFUComplete = checkEFUCompletion(room);
        
        // ★ 必須同時滿足：EFU 完成 + 沒有任何正在進行中的已派發任務 + 任務隊列為空
        // 避免一位玩家答完就結束，而另一位玩家仍在答題
        const hasInFlightTasks = room.dispatchedTasks.size > 0;
        const hasQueuedTasks = room.taskQueue.length > 0;
        const canEndPhase2 = isEFUComplete && !hasInFlightTasks && !hasQueuedTasks;
        
        if (isEFUComplete && (hasInFlightTasks || hasQueuedTasks)) {
          console.log(`[Phase 2] EFU 條件已滿足，但仍有 ${room.dispatchedTasks.size} 個已派發任務、${room.taskQueue.length} 個待派發任務，等待全部完成`);
        }
        
        // 找到發題者的連線
        const peer = Array.from(connections.values()).find(
          p => (p as GamePeer).playerId === playerId
        );
        
        if (canEndPhase2) {
          console.log(`[Phase 2] 所有關鍵節點 EFU 已完成且無待處理任務，進入驗證階段`);
          room.status = "verification";
          
          // 顯示完整 MVFT
          broadcastToRoom(room.roomId, "", {
            type: "stage_completed",
            stage: "data-filling",
            nextStage: "verification",
            mvft: room.mvft,  // 現在才展示 MVFT
          });
          
          broadcastToSpectators(roomId, {
            type: "spectator:efu_complete",
            mvft: room.mvft,
          });
          
          // 通知發題者任務確認（EFU 完成）
          if (peer) {
            peer.send(JSON.stringify({
              type: "data_filling:task_confirmed",
              taskId,
              answer,
              efu_complete: true,
              nextTask: null,
            }));
          }
        } else {
          // 6. 派發下一個任務給完成任務的玩家
          const nextTaskForPlayer = selectNextTaskForPlayer(room, room.taskQueue, playerId);
          
          if (nextTaskForPlayer) {
            room.taskQueue = room.taskQueue.filter(t => t.taskId !== nextTaskForPlayer.taskId);
            room.dispatchedTasks.set(nextTaskForPlayer.taskId, nextTaskForPlayer);
            
            console.log(`[Phase 2] 為玩家 ${player.name} 派發新任務 ${nextTaskForPlayer.taskId}`);
            
            // 通知旁觀者
            broadcastToSpectators(roomId, {
              type: "spectator:task_dispatched",
              taskId: nextTaskForPlayer.taskId,
              assignedPlayerId: nextTaskForPlayer.assignedPlayerId,
            });
          } else {
            console.log(`[Phase 2] 沒有更多任務可派發給玩家 ${player.name}`);
          }
          
          // 7. 通知發題者（包含下一個任務）
          if (peer) {
            peer.send(JSON.stringify({
              type: "data_filling:task_confirmed",
              taskId,
              answer,
              efu_complete: false,
              nextTask: nextTaskForPlayer ?? null,  // 包含下一個任務
            }));
          }
        }
      }
      
      // 跳過任務
      if (data.type === "data_filling:skip") {
        const { taskId } = data;
        const { roomId, playerId } = gamePeer;
        
        if (!roomId || !playerId) return;
        
        const room = gameState.rooms.get(roomId);
        if (!room || room.status !== "data-filling") return;
        
        const task = room.dispatchedTasks.get(taskId);
        if (!task || task.assignedPlayerId !== playerId) {
          console.error(`[Phase 2] 無法跳過任務: ${taskId}`);
          return;
        }
        
        const player = room.players.get(playerId);
        if (!player) return;
        
        console.log(`[Phase 2] 玩家 ${player.name} 跳過任務 ${taskId}`);
        
        // 1. 增加跳過計數並降低優先級
        const playerState = room.phase2State?.playerStates.get(playerId);
        if (playerState) {
          const skipCount = (playerState.skippedTasks.get(taskId) || 0) + 1;
          playerState.skippedTasks.set(taskId, skipCount);
          
          // 跳過太多次的任務降低優先級
          if (skipCount > 2) {
            const priorityLevels: TaskPriority[] = ["L1", "L2", "L3", "L4", "L5", "L6"];
            const currentIndex = priorityLevels.indexOf(task.priority);
            if (currentIndex < 5) {
              task.priority = priorityLevels[currentIndex + 1];
            }
          }
        }
        
        // 2. 從已派發移除，重新加入待派發隊列
        room.dispatchedTasks.delete(taskId);
        room.taskQueue.push(task);
        task.assignedPlayerId = undefined;
        task.isLocked = false;
        
        // 3. 派發其他任務給此玩家
        const nextTask = selectNextTaskForPlayer(room, room.taskQueue, playerId);
        
        if (nextTask) {
          room.taskQueue = room.taskQueue.filter(t => t.taskId !== nextTask.taskId);
          room.dispatchedTasks.set(nextTask.taskId, nextTask);
          
          console.log(`[Phase 2] 為跳過的玩家 ${player.name} 派發新任務 ${nextTask.taskId}`);
        } else {
          console.log(`[Phase 2] 沒有更多任務可派發給跳過的玩家 ${player.name}`);
        }
        
        // 發送確認給玩家（包含下一個任務）
        broadcastToPlayer(room.roomId, player.socketId, {
          type: "data_filling:task_skipped",
          taskId,
          nextTask: nextTask ?? null,
        });
        
        // 4. 推送紀錄給旁觀者
        const skipRecord: AnswerRecord = {
          timestamp: Date.now(),
          playerName: player.name,
          playerId,
          summary: `跳過任務 ${taskId}`,
          status: "skipped",
        };
        room.answerHistory.unshift(skipRecord);
        if (room.answerHistory.length > 50) room.answerHistory.pop();
        broadcastToSpectators(roomId, { type: "spectator:answer_submitted", ...skipRecord });
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
}

// ════════════════════════════════════════════════════════════════════
// 輔助工具函式
// ════════════════════════════════════════════════════════════════════

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

// 發送訊息給特定玩家
function broadcastToPlayer(roomId: string, socketId: string, message: any) {
  const peerConnection = connections.get(socketId);
  if (peerConnection) {
    const messageStr = JSON.stringify(message);
    peerConnection.send(messageStr);
  }
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
    sendNextQuestion(room, player).catch((err) => console.error(`[Question] 發送第一題失敗: ${err}`));
  }
  
  console.log(`[Question] 已為 ${players.length} 位玩家生成問題隊列`);
}

// 隨機選擇指定數量的玩家
function selectRandomPlayers(players: Player[], count: number): Player[] {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, players.length));
}

// 發送下一題給玩家
async function sendNextQuestion(room: Room, player: Player) {
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
    await checkAllQuestionsCompleted(room);
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
async function checkAllQuestionsCompleted(room: Room) {
  const activePlayers = Array.from(room.players.values()).filter(p => !p.isOffline && !p.isObserver);
  
  const allCompleted = activePlayers.every(player => {
    if (!player.questionQueue) return false;
    return player.answeredQuestions === player.questionQueue.length;
  });
  
  if (allCompleted) {
    console.log(`[Question] 所有玩家已完成關係掃描階段`);
    console.log(`[MVFT] 共收集 ${room.relationships.length} 筆關係紀錄，開始生成骨架 MVFT...`);
    
    // ── 生成骨架 MVFT（內部使用）───────────────────────────────────────────
    const playerInfoList = Array.from(room.players.values()
    ).filter(p => !p.isObserver).map(p => ({
      playerId: p.playerId,
      nodeId: p.nodeId,
      name: p.name,
      gender: p.gender,
      birthday: p.birthday,
    }));
    
    const mvft = buildSkeletonMvft(room.relationships, playerInfoList);
    room.mvft = mvft;  // 儲存但暫不顯示
    
    console.log(`[MVFT] 骨架生成完成：${mvft.nodes.length} 個節點，${mvft.edges.length} 條邊`);
    
    // ── Phase 2：虛擬節點實例化 & 任務生成 ───────────────────────────────
    try {
      const { instantiateVirtualNodes, generatePhase2Tasks, initializeEFUTrackers, selectNextTaskToDispatch } = await import("../utils/phase2TaskGenerator");
      
      // 1. 實例化虛擬節點
      const virtualNodes = instantiateVirtualNodes(room.relationships, room.players);
      if (!room.familyTree.virtualNodes) {
        room.familyTree.virtualNodes = new Map();
      }
      for (const [nodeId, vnode] of virtualNodes) {
        room.familyTree.virtualNodes.set(nodeId, vnode);
      }
      console.log(`[Phase 2] 實例化虛擬節點: ${virtualNodes.size} 個`);
      
      // 2. 生成任務隊列
      const allTasks = generatePhase2Tasks(room, virtualNodes);
      room.taskQueue = allTasks;
      room.dispatchedTasks = new Map();
      console.log(`[Phase 2] 生成任務隊列: ${allTasks.length} 個任務`);
      
      // 3. 初始化 EFU 追踪
      if (!room.phase2State) {
        room.phase2State = {
          efuTrackers: initializeEFUTrackers(virtualNodes),
          playerStates: new Map(),
          taskDispatchIndex: 0,
          lastDispatchTime: Date.now(),
        };
      }
      
      // 4. 初始化玩家 Phase 2 狀態
      for (const [playerId] of room.players) {
        if (!room.phase2State.playerStates.has(playerId)) {
          room.phase2State.playerStates.set(playerId, {
            playerId,
            completedTasks: [],
            skippedTasks: new Map(),
            contributionScore: 0,
          });
        }
      }
      
      // 5. 進入資料填充階段
      room.status = "data-filling";
      console.log(`[Phase 2] 進入資料填充階段`);
      
      // 6. 派發第一批任務（每位玩家都派發一個初始任務）
      const tasksToDispatch: Phase2Task[] = [];
      const dispatchedPlayerIds = new Set<string>();
      
      // 每位玩家都要有一個初始任務
      for (const [playerId] of room.players) {
        if (room.taskQueue.length === 0) break;
        
        // 為這位玩家選擇最適合的任務
        const nextTask = selectNextTaskToDispatch(room, room.taskQueue);
        if (nextTask) {
          nextTask.assignedPlayerId = playerId; // 確保分配給當前玩家
          nextTask.isLocked = true;
          // 從隊列移除，加入已派發
          room.taskQueue = room.taskQueue.filter(t => t.taskId !== nextTask.taskId);
          room.dispatchedTasks.set(nextTask.taskId, nextTask);
          tasksToDispatch.push(nextTask);
          dispatchedPlayerIds.add(playerId);
        }
      }
      
      console.log(`[Phase 2] 派發了 ${tasksToDispatch.length} 個初始任務給 ${dispatchedPlayerIds.size} 位玩家`);
      
      // 7. 廣播進入 Phase 2
      broadcastToRoom(room.roomId, "", {
        type: "stage_completed",
        stage: "relationship-scan",
        nextStage: "data-filling",
        // 不附帶 MVFT，延遲到 Phase 2 完成時
      });
      
      // 8. 向各玩家派發任務
      for (const task of tasksToDispatch) {
        const assignedPlayer = room.players.get(task.assignedPlayerId!);
        if (assignedPlayer) {
          console.log(`[Phase 2] 向玩家 ${assignedPlayer.name} (socket: ${assignedPlayer.socketId}) 派發任務 ${task.taskId}`);
          // 透過 WebSocket 發送給對應玩家
          broadcastToPlayer(room.roomId, assignedPlayer.socketId, {
            type: "data_filling:task_assigned",
            task,
          });
        } else {
          console.log(`[Phase 2] 警告: 找不到玩家 ${task.assignedPlayerId}`);
        }
      }
      
      // 通知旁觀者：Phase 2 開始
      broadcastToSpectators(room.roomId, {
        type: 'spectator:phase_changed',
        phase: 'data-filling',
        virtualNodesCount: virtualNodes.size,
        taskQueueSize: room.taskQueue.length,
      });
      
    } catch (error) {
      console.error(`[Phase 2] 錯誤: ${error}`);
      // Fallback: 顯示骨架 MVFT（容錯機制）
      room.status = "in-game";
      broadcastToRoom(room.roomId, "", {
        type: "stage_completed",
        stage: "relationship-scan",
        nextStage: "in-game",
        mvft,
      });
    }
  }
}
