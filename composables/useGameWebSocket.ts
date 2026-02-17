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
  const roomState = ref<RoomState | null>(null)
  const currentPlayer = ref<{ playerId: string; nodeId: string } | null>(null)
  const isOwner = ref(false)
  const error = ref<string | null>(null)
  const currentQuestion = ref<RelationshipQuestion | null>(null)
  const gamePhase = ref<'waiting' | 'relationship-scan' | 'in-game' | 'finished'>('waiting')

  // 連線到 WebSocket
  const connect = () => {
    if (ws.value) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    ws.value = new WebSocket(wsUrl)

    // 儲存到 window 供其他組件使用
    if (typeof window !== 'undefined') {
      (window as any).__gameWS = ws.value
    }

    ws.value.onopen = () => {
      console.log('[WS] 連線成功')
      isConnected.value = true
      error.value = null
    }

    ws.value.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        handleMessage(data)
      } catch (err) {
        console.error('[WS] 解析訊息失敗:', err)
      }
    }

    ws.value.onclose = () => {
      console.log('[WS] 連線關閉')
      isConnected.value = false
      ws.value = null

      // 清除 window 參考
      if (typeof window !== 'undefined') {
        delete (window as any).__gameWS
      }

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
      console.error('[WS] 連線錯誤:', err)
      error.value = '連線發生錯誤'
    }
  }

  // 處理接收到的訊息
  const handleMessage = (data: any) => {
    console.log('[WS] 收到訊息:', data.type)

    switch (data.type) {
      case 'room:created':
        // 房間建立成功
        console.log('房間已建立:', data.roomId)
        break

      case 'player_registered':
        // 玩家註冊成功
        currentPlayer.value = {
          playerId: data.playerId,
          nodeId: data.nodeId,
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
          gamePhase.value = 'in-game'
          if (roomState.value) {
            roomState.value.status = 'in-game'
          }
        }
        // 遊戲開始
        console.log('遊戲已開始')
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
        // 旁觀者加入
        console.log('旁觀者模式')
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
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(data))
    } else {
      console.error('[WS] 無法發送訊息：連線未建立')
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
    roomState,
    currentPlayer,
    isOwner,
    error,
    currentQuestion,
    gamePhase,

    // 方法
    connect,
    disconnect,
    createRoom,
    notifyTyping,
    joinRoom,
    startGame,
    answerRelationship,
    skipQuestion,
    reconnect,
    clearError,
  }
}
