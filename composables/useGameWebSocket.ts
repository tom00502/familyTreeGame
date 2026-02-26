// WebSocket 連線管理 Composable

import { ref } from 'vue'

export interface Player {
  playerId: string
  name: string
  gender: 'male' | 'female'
  score: number
  isOffline: boolean
  isObserver: boolean
}

export interface RelationshipQuestion {
  questionId: string
  askedPlayerId: string
  targetPlayerId: string
  targetPlayerName: string
  targetPlayerGender: 'male' | 'female' // 目標玩家（被問的人）的性別
}

export interface MvftDisplayNode {
  id: string
  label: string
  gender: 'male' | 'female' | 'unknown'
  isPlayer: boolean
  playerId?: string
  isVirtual: boolean
}

export interface MvftDisplayEdge {
  from: string
  to: string
  type: 'parent' | 'spouse'
  label: string
}

export interface MvftData {
  nodes: MvftDisplayNode[]
  edges: MvftDisplayEdge[]
  generatedAt: number
}

// ── 旁觀者相關型別 ─────────────────────────────────────────────

export interface SpectatorPlayerStatus {
  playerId: string
  name: string
  isOffline: boolean
  answeredCount: number
  totalQuestions: number
  currentQuestionSummary: string | null
}

export interface SpectatorAnswerRecord {
  timestamp: number
  playerName: string
  playerId: string
  summary: string
  status: 'confirmed' | 'skipped'
}

export interface SpectatorState {
  roomName: string
  roomStatus: string
  players: SpectatorPlayerStatus[]
  answerHistory: SpectatorAnswerRecord[]
  mvft: MvftData | null
}

export interface RoomState {
  roomId: string
  roomName: string
  status: 'idle' | 'waiting' | 'relationship-scan' | 'in-game' | 'finished'
  gameTime: number
  remainingTime: number
  players: Player[]
  isLocked: boolean
  currentQuestion?: RelationshipQuestion
}

export function useGameWebSocket() {
  const ws = ref<WebSocket | null>(null)
  const isConnected = ref(false)
  const createdRoomId = ref<string | null>(null) // 新增：追蹤房間建立
  const roomState = ref<RoomState | null>(null)
  const currentPlayer = ref<{ playerId: string; nodeId: string } | null>(null)
  const isOwner = ref(false)
  const error = ref<string | null>(null)
  const currentQuestion = ref<RelationshipQuestion | null>(null)
  const gamePhase = ref<'waiting' | 'relationship-scan' | 'data-filling' | 'verification' | 'in-game' | 'finished'>('waiting')
  const mvftData = ref<MvftData | null>(null)
  // 旁觀者狀態
  const isSpectator = ref(false)
  const spectatorState = ref<SpectatorState | null>(null)
  // Phase 2 狀態
  const currentTask = ref<any>(null)
  const efuComplete = ref(false)

  // 連線到 WebSocket
  const connect = () => {
    // 如果連線已存在且處於 OPEN 狀態，直接使用
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      console.log('[WS] 連線已存在且處於 OPEN 狀態，無需重新連線')
      isConnected.value = true
      return
    }

    // 如果連線存在但正在連線中 (CONNECTING)，等待即可
    if (ws.value && ws.value.readyState === WebSocket.CONNECTING) {
      console.log('[WS] 連線正在建立中 (CONNECTING)...')
      return
    }

    // 連線不存在或已關閉，建立新連線
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    console.log('[WS] 建立新 WebSocket 連線到:', wsUrl)
    ws.value = new WebSocket(wsUrl)

    ws.value.onopen = () => {
      console.log('[WS] ✓ onopen 觸發，連線成功')
      isConnected.value = true
      error.value = null
    }

    ws.value.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        console.log('[WS] 收到訊息:', data.type)
        handleMessage(data)
      } catch (err) {
        console.error('[WS] 解析訊息失敗:', err)
      }
    }

    ws.value.onclose = () => {
      console.log('[WS] ✗ 連線關閉')
      isConnected.value = false
      ws.value = null

      // 自動重連
      setTimeout(() => {
        if (currentPlayer.value) {
          connect()
          // 重連後嘗試恢復狀態
          if (roomState.value) {
            reconnect(roomState.value.roomId, currentPlayer.value.playerId)
          }
        }
      }, 2000)
    }

    ws.value.onerror = (err: Event) => {
      console.error('[WS] ✗ 連線錯誤:', err)
      error.value = '連線發生錯誤'
    }
  }

  // 處理接收到的訊息
  const handleMessage = (data: any) => {
    console.log('[WS] 收到訊息:', data.type)

    switch (data.type) {
      case 'room:created':
        // 房間建立成功
        createdRoomId.value = data.roomId
        console.log('房間已建立:', data.roomId)
        break

      case 'player_registered':
        // 玩家註冊成功
        currentPlayer.value = {
          playerId: data.playerId,
          nodeId: data.nodeId,
        }
        // 如果包含 isOwner，立即設置房主身份
        if (data.isOwner !== undefined) {
          isOwner.value = data.isOwner
        }
        // 儲存到 localStorage 以便重連
        if (roomState.value) {
          localStorage.setItem('playerId', data.playerId)
          localStorage.setItem('roomId', roomState.value.roomId)
        }
        break

      case 'member:joined':
        // 有新成員加入
        console.log('新成員加入:', data.name)
        if (data.playerId === currentPlayer.value?.playerId) {
          isOwner.value = data.isOwner
        }
        break

      case 'member:typing_notify':
        // 有人正在輸入
        break

      case 'sync:state':
        // 同步房間狀態
        roomState.value = {
          roomId: data.roomId,
          roomName: data.roomName,
          status: data.status,
          gameTime: data.gameTime,
          remainingTime: data.remainingTime,
          players: data.players,
          isLocked: data.isLocked,
        }
        break

      case 'game:started':
        console.log('遊戲已開始，進入第一階段')
        gamePhase.value = 'relationship-scan'
        if (roomState.value) {
          roomState.value.status = 'relationship-scan'
        }
        break
      
      case 'relationship_question':
        // 收到關係問題
        console.log('收到關係問題:', data)
        // 只處理發給自己的問題
        if (data.askedPlayerId === currentPlayer.value?.playerId) {
          currentQuestion.value = {
            questionId: data.questionId,
            askedPlayerId: data.askedPlayerId,
            targetPlayerId: data.targetPlayerId,
            targetPlayerName: data.targetPlayerName,
            targetPlayerGender: data.targetPlayerGender,
          }
        }
        break
      
      case 'relationship_confirmed':
        // 關係已確認 - 只處理自己回答的問題
        console.log('關係已確認:', data)
        if (currentQuestion.value?.questionId === data.questionId) {
          // 清空當前問題，等待下一題
          currentQuestion.value = null
        }
        break
      
      case 'stage_completed':
        // 階段完成
        console.log('階段完成:', data.stage)
        if (data.stage === 'relationship-scan') {
          // 進入 Phase 2：資料填充（不立即顯示 MVFT）
          gamePhase.value = 'data-filling'
          if (roomState.value) {
            roomState.value.status = 'data-filling'
          }
          console.log('[Phase 2] 進入資料填充階段')
        } else if (data.stage === 'data-filling') {
          // 儲存完整 MVFT 後進入驗證或完成
          if (data.mvft) {
            mvftData.value = data.mvft
            console.log('[MVFT] 收到完整族譜:', data.mvft.nodes.length, '節點,', data.mvft.edges.length, '邊')
          }
          gamePhase.value = data.nextStage === 'verification' ? 'verification' : 'in-game'
          if (roomState.value) {
            roomState.value.status = gamePhase.value
          }
          console.log('[大揭曉] 完整族譜已產生')
        }
        break

      case 'owner_changed':
        // 房主變更
        console.log('新房主:', data.newOwnerName)
        if (currentPlayer.value && data.newOwnerId === currentPlayer.value.playerId) {
          isOwner.value = true
        }
        break

      case 'owner_restored':
      case 'reconnected':
        // 重連成功
        roomState.value = data.roomState
        console.log('重連成功')
        break

      case 'player_offline':
        // 玩家離線
        console.log('玩家離線:', data.name)
        break

      case 'spectator:joined':
        // 蓉觀者模式 — spectator:sync 轉即跟進
        isSpectator.value = true
        console.log('[WS] ✓ spectator:joined 已收到，spectatorId:', data.spectatorId)
        break

      case 'spectator:sync':
        // 旁觀者初始同步：完整房間狀態
        console.log('[WS] ✓ spectator:sync 已收到')
        console.log('[WS]    roomName:', data.roomName)
        console.log('[WS]    roomStatus:', data.roomStatus)
        console.log('[WS]    players 數量:', data.players?.length ?? 0)
        console.log('[WS]    answerHistory 數量:', data.answerHistory?.length ?? 0)
        console.log('[WS]    mvft:', data.mvft ? '有' : '無')
        spectatorState.value = {
          roomName: data.roomName,
          roomStatus: data.roomStatus,
          players: data.players,
          answerHistory: data.answerHistory ?? [],
          mvft: data.mvft ?? null,
        }
        console.log('[WS] ✓ spectatorState 已設置')
        console.log('[WS] 旁觀者狀態同步完成')
        break

      case 'spectator:answer_submitted':
        if (spectatorState.value) {
          spectatorState.value.answerHistory.unshift({
            timestamp: data.timestamp,
            playerName: data.playerName,
            playerId: data.playerId,
            summary: data.summary,
            status: data.status,
          })
          if (spectatorState.value.answerHistory.length > 50) {
            spectatorState.value.answerHistory.pop()
          }
        }
        break

      case 'spectator:player_status':
        if (spectatorState.value) {
          const idx = spectatorState.value.players.findIndex(p => p.playerId === data.playerId)
          const updated: SpectatorPlayerStatus = {
            playerId: data.playerId,
            name: data.name,
            isOffline: data.isOffline,
            answeredCount: data.answeredCount,
            totalQuestions: data.totalQuestions,
            currentQuestionSummary: data.currentQuestionSummary,
          }
          if (idx >= 0) {
            spectatorState.value.players[idx] = updated
          } else {
            spectatorState.value.players.push(updated)
          }
        }
        break

      case 'spectator:tree_updated':
        if (spectatorState.value) {
          spectatorState.value.mvft = data.mvft
        }
        break

      case 'spectator:redirect':
        // 伺服器告知遊戲尚未開始，應回到加入頁
        isSpectator.value = false
        spectatorState.value = null
        console.log('[WS] spectator:redirect → game not started')
        break

      case 'data_filling:task_assigned':
        // Phase 2: 收到任務派發（初始派發或來自其他來源）
        console.log('[Phase 2] 收到任務派發:', data.task)
        currentTask.value = data.task
        break

      case 'data_filling:task_confirmed':
        // Phase 2: 任務確認完成，同時可能包含下一個任務
        console.log('[Phase 2] 任務確認完成')
        if (data.efu_complete) {
          console.log('[Phase 2] EFU 已完成，進入驗證階段')
          efuComplete.value = true
          currentTask.value = null
        } else if (data.nextTask) {
          // 有下一個任務
          console.log('[Phase 2] 收到下一個任務:', data.nextTask)
          currentTask.value = data.nextTask
        } else {
          // 沒有更多任務，顯示等待畫面
          console.log('[Phase 2] 沒有更多任務可執行')
          currentTask.value = null
        }
        break

      case 'data_filling:task_skipped':
        // Phase 2: 任務跳過確認，同時可能包含下一個任務
        console.log('[Phase 2] 任務跳過確認')
        if (data.nextTask) {
          console.log('[Phase 2] 跳過後收到下一個任務:', data.nextTask)
          currentTask.value = data.nextTask
        } else {
          console.log('[Phase 2] 跳過後沒有更多任務')
          currentTask.value = null
        }
        break

      case 'error':
        // 錯誤訊息
        error.value = data.message
        console.error('[WS] 伺服器錯誤:', data.message)
        break

      default:
        console.log('[WS] 未處理的訊息類型:', data.type)
    }
  }

  // 發送訊息
  const send = (data: any) => {
    const readyStateMap: { [key: number]: string } = {
      0: 'CONNECTING',
      1: 'OPEN',
      2: 'CLOSING',
      3: 'CLOSED',
    }
    const wsState = ws.value
      ? `readyState=${ws.value.readyState} (${readyStateMap[ws.value.readyState]})`
      : 'ws.value=null'
    console.log('[WS] 嘗試發送訊息:', data.type, '連線狀態:', wsState)
    
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      console.log('[WS] ✓ 訊息已發送:', data.type)
      ws.value.send(JSON.stringify(data))
    } else {
      console.error('[WS] ✗ 無法發送訊息：連線未開放', wsState)
    }
  }

  // 建立房間
  const createRoom = (name: string, gameTime: number) => {
    send({
      type: 'room:create',
      name,
      gameTime,
    })
  }
   
  
  // 回答關係問題
  const answerRelationship = (questionId: string, answer: { direction?: string; relation: string }) => {
    send({
      type: 'relationship_answer',
      questionId,
      answer,
    })
  }
  
  // 跳過問題
  const skipQuestion = (questionId: string) => {
    send({
      type: 'relationship_skip',
      questionId,
    })
  }

  // Phase 2: 回答資料填充任務
  const answerTask = (taskId: string, answer: any) => {
    send({
      type: 'data_filling:answer',
      taskId,
      answer,
    })
  }

  // Phase 2: 跳過資料填充任務
  const skipTask = (taskId: string) => {
    send({
      type: 'data_filling:skip',
      taskId,
    })
  }

  // 通知正在輸入
  const notifyTyping = (roomId: string) => {
    send({
      type: 'member:typing',
      roomId,
    })
  }

  // 加入房間
  const joinRoom = (roomId: string, playerInfo: {
    name: string
    gender: 'male' | 'female'
    birthday: string
  }) => {
    send({
      type: 'member:join',
      roomId,
      name: playerInfo.name,
      gender: playerInfo.gender,
      birthday: playerInfo.birthday,
    })
  }

  // 開始遊戲（僅房主）
  const startGame = (roomId: string) => {
    send({
      type: 'game:start',
      roomId,
    })
  }

  // 以旁觀者身份進入（不需填個人資料）
  const watchRoom = (roomId: string) => {
    console.log('[WS] watchRoom() 被調用，roomId:', roomId)
    send({
      type: 'spectator:watch',
      roomId,
    })
  }

  // 重連
  const reconnect = (roomId: string, playerId: string) => {
    send({
      type: 'reconnect',
      roomId,
      playerId,
    })
  }

  // 斷開連線
  const disconnect = () => {
    if (ws.value) {
      ws.value.close()
      ws.value = null
    }
    isConnected.value = false
  }

  // 清除錯誤
  const clearError = () => {
    error.value = null
  }

  return {
    // 狀態
    isConnected,
    createdRoomId,
    roomState,
    currentPlayer,
    isOwner,
    error,
    currentQuestion,
    gamePhase,
    mvftData,
    isSpectator,
    spectatorState,
    currentTask,
    efuComplete,

    // 方法
    connect,
    disconnect,
    createRoom,
    notifyTyping,
    joinRoom,
    startGame,
    watchRoom,
    answerRelationship,
    skipQuestion,
    answerTask,
    skipTask,
    reconnect,
    clearError,
  }
}
