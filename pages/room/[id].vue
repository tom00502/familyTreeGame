<template>
<div>
  <!-- 資料輸入階段 -->
  <PlayerInfoForm v-if="!hasJoined" :room-id="roomId" @submit="handlePlayerInfoSubmit" @typing="handleTyping" />

  <!-- 等待大廳階段 -->
  <GameLobby v-else-if="gamePhase === 'waiting'" ref="lobbyRef" :room-id="roomId" :room-state="roomState"
    :is-owner="isOwner" :current-player-id="currentPlayer?.playerId" @start-game="handleStartGame" />

  <!-- 第一階段：關係掃描 -->
  <RelationshipQuestion v-else-if="gamePhase === 'relationship-scan' && currentQuestion"
    :current-question="currentQuestion" :time-limit="120" @answer="handleAnswerQuestion" @skip="handleSkipQuestion"
    @timeout="handleQuestionTimeout" />

  <!-- 等待其他玩家回答 -->
  <div v-else-if="gamePhase === 'relationship-scan' && !currentQuestion"
    class="min-h-screen bg-[#FAF8F3] flex items-center justify-center p-6">
    <div class="text-center space-y-4">
      <div
        class="w-16 h-16 mx-auto bg-[#8B2635] rounded-full flex items-center justify-center border-4 border-[#D4AF37] shadow-lg">
        <div class="text-2xl text-[#FAF8F3]">⏳</div>
      </div>
      <h2 class="text-xl font-bold text-[#5C2E2E]">等待其他家人回答問題...</h2>
      <p class="text-[#8B8278]">請稍候片刻</p>
    </div>
  </div>

  <!-- 第二階段：資料填充 -->
  <DataFillingQuestion v-else-if="gamePhase === 'data-filling' && currentTask" :current-task="currentTask"
    :time-limit="gameTimeRemaining" :efu-progress="efuProgress" :skipped-count="currentTaskSkipCount"
    @answer-submitted="handleTaskAnswer" @task-skipped="handleTaskSkipped" @time-expired="handleGameTimeout" />

  <!-- 等待其他玩家填充資料 -->
  <div v-else-if="gamePhase === 'data-filling' && !currentTask"
    class="min-h-screen bg-[#FAF8F3] flex items-center justify-center p-6">
    <div class="text-center space-y-4">
      <div
        class="w-16 h-16 mx-auto bg-[#D4AF37] rounded-full flex items-center justify-center border-4 border-[#8B2635] shadow-lg">
        <div class="text-2xl">📝</div>
      </div>
      <h2 class="text-xl font-bold text-[#5C2E2E]">等待其他家人回答問題...</h2>
      <p class="text-[#8B8278]">請稍候片刻</p>
      <div class="w-8 h-8 border-4 border-[#8B2635] border-t-transparent rounded-full animate-spin mx-auto"></div>
    </div>
  </div>

  <!-- 第一階段完成：骨架族譜預覽（MVFT 驗證模式） -->
  <MvftPreview v-else-if="gamePhase === 'verification' && mvftData" :mvft="mvftData" />

  <!-- verification 或 in-game 尚未收到 MVFT 時的等待狀態 -->
  <div v-else-if="(gamePhase === 'verification' || gamePhase === 'in-game') && !mvftData"
    class="min-h-screen bg-[#FAF8F3] flex items-center justify-center p-6">
    <div class="text-center space-y-4">
      <div
        class="w-16 h-16 mx-auto bg-[#D4AF37] rounded-full flex items-center justify-center border-4 border-[#8B2635] shadow-lg">
        <div class="text-2xl">🌳</div>
      </div>
      <h2 class="text-xl font-bold text-[#5C2E2E]">族譜結構生成中…</h2>
      <p class="text-[#8B8278]">正在組裝完整族譜，請稍候</p>
      <div class="w-8 h-8 border-4 border-[#8B2635] border-t-transparent rounded-full animate-spin mx-auto"></div>
    </div>
  </div>

  <!-- 錯誤提示 -->
  <div v-if="error"
    class="fixed top-6 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50">
    {{ error }}
  </div>

  <!-- Loading -->
  <div v-if="isLoading" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg p-6 flex flex-col items-center gap-4">
      <div class="w-12 h-12 border-4 border-[#8B2635] border-t-transparent rounded-full animate-spin"></div>
      <p class="text-[#5C2E2E]">{{ loadingMessage }}</p>
    </div>
  </div>
</div>
</template>

<script setup lang="ts">
console.log('[Room] ========== room/[id].vue 腳本開始執行 ==========')

import { useGameWebSocket } from '~/composables/useGameWebSocket'
import PlayerInfoForm from '~/components/PlayerInfoForm.vue'
import GameLobby from '~/components/GameLobby.vue'
import RelationshipQuestion from '~/components/RelationshipQuestion.vue'
import DataFillingQuestion from '~/components/DataFillingQuestion.vue'
import MvftPreview from '~/components/MvftPreview.vue'

const route = useRoute()
const router = useRouter()

console.log('[Room] route 和 router 已初始化')

const roomId = computed(() => route.params.id as string)

console.log('[Room] 當前 roomId:', roomId.value)

const {
  connect,
  isConnected,
  roomState,
  currentPlayer,
  isOwner,
  error: wsError,
  currentQuestion,
  gamePhase,
  mvftData,
  notifyTyping,
  joinRoom,
  startGame,
  answerRelationship,
  skipQuestion,
  // Phase 2
  currentTask,
  answerTask,
  skipTask,
} = useGameWebSocket()

console.log('[Room] useGameWebSocket 已初始化')

const hasJoined = ref(false)
const error = ref<string | null>(null)
const isLoading = ref(true)
const loadingMessage = ref('連線中...')
const lobbyRef = ref<InstanceType<typeof GameLobby> | null>(null)

// Phase 2 狀態（從 composable 取得的以外的本地狀態）
const gameTimeRemaining = ref(180)
const efuProgress = ref(0)
const currentTaskSkipCount = ref(0)

// 建立連線
onMounted(async () => {
  try {
    // ① 確認房間狀態
    const status = await $fetch<{
      roomId: string
      roomName: string
      status: string
      isLocked: boolean
      playerCount: number
    }>(`/api/room/${roomId.value}/status`).catch(() => null)

    if (!status) {
      // 房間不存在
      error.value = '房間不存在或已結束'
      isLoading.value = false
      return
    }

    if (status.isLocked) {
      // 遊戲已開始 → 導向旁觀者看板
      console.log('[Room] ✓ 偵測到遊戲已鎖定 (isLocked=true)，導向到 dashboard')
      console.log('[Room] 導向目標:', `/room/dashboard/${roomId.value}`)
      router.push(`/room/dashboard/${roomId.value}`)
      return
    }

    // ② 房間尚在等待中，正常進入
    const savedPlayerId = localStorage.getItem('playerId')
    const savedRoomId = localStorage.getItem('roomId')

    if (savedPlayerId && savedRoomId === roomId.value) {
      // 嘗試重連
      hasJoined.value = true
      loadingMessage.value = '重新連線中...'
    }

    connect()

    // 等待連線
    await waitForConnection()

    isLoading.value = false
  } catch (err: any) {
    console.error('連線失敗:', err)
    error.value = '無法連線到伺服器'
    isLoading.value = false
  }
})

// 等待連線建立
const waitForConnection = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    const maxAttempts = 50 // 5 秒
    let attempts = 0

    const checkConnection = setInterval(() => {
      attempts++

      if (isConnected.value) {
        clearInterval(checkConnection)
        resolve()
      } else if (attempts >= maxAttempts) {
        clearInterval(checkConnection)
        reject(new Error('連線逾時'))
      }
    }, 100)
  })
}

// 處理玩家資料提交
const handlePlayerInfoSubmit = (data: {
  name: string
  gender: 'male' | 'female'
  birthday: string
}) => {
  isLoading.value = true
  loadingMessage.value = '加入房間中...'

  try {
    joinRoom(roomId.value, data)

    // 監聽加入成功
    const checkJoined = setInterval(() => {
      if (currentPlayer.value) {
        clearInterval(checkJoined)
        hasJoined.value = true
        isLoading.value = false
        console.log('成功加入房間')
      }
    }, 100)

    // 10 秒後超時
    setTimeout(() => {
      clearInterval(checkJoined)
      if (!hasJoined.value) {
        isLoading.value = false
        error.value = '加入房間失敗，請重試'
      }
    }, 10000)
  } catch (err: any) {
    console.error('加入房間失敗:', err)
    error.value = err.message || '加入房間失敗'
    isLoading.value = false
  }
}

// 處理正在輸入
const handleTyping = () => {
  notifyTyping(roomId.value)
}

// 處理開始遊戲
const handleStartGame = () => {
  isLoading.value = true
  loadingMessage.value = '開始遊戲中...'

  try {
    startGame(roomId.value)

    // 監聽遊戲開始
    const checkStarted = setInterval(() => {
      if (gamePhase.value === 'relationship-scan') {
        clearInterval(checkStarted)
        isLoading.value = false
        console.log('遊戲已開始，進入第一階段')
      }
    }, 100)

    // 5 秒後超時
    setTimeout(() => {
      clearInterval(checkStarted)
      isLoading.value = false
    }, 5000)
  } catch (err: any) {
    console.error('開始遊戲失敗:', err)
    error.value = err.message || '開始遊戲失敗'
    isLoading.value = false
  }
}

// 處理回答問題
const handleAnswerQuestion = (answer: { direction?: string; relation: string }) => {
  if (!currentQuestion.value) return

  console.log('回答問題:', answer)
  answerRelationship(currentQuestion.value.questionId, answer)
}

// 處理跳過問題
const handleSkipQuestion = () => {
  if (!currentQuestion.value) return

  console.log('跳過問題')
  skipQuestion(currentQuestion.value.questionId)
}

// 處理問題超時
const handleQuestionTimeout = () => {
  if (!currentQuestion.value) return

  console.log('問題超時')
  skipQuestion(currentQuestion.value.questionId)
}

// ────────────────────────────────────────────
// Phase 2：資料填充事件處理
// ────────────────────────────────────────────

// 處理任務答案提交
const handleTaskAnswer = (answer: any) => {
  if (!currentTask.value) return

  console.log('[Phase 2] 提交任務答案:', answer)
  answerTask(currentTask.value.taskId, answer)
}

// 處理任務跳過
const handleTaskSkipped = () => {
  if (!currentTask.value) return

  console.log('[Phase 2] 跳過任務:', currentTask.value.taskId)
  currentTaskSkipCount.value++
  skipTask(currentTask.value.taskId)
}

// 處理遊戲超時
const handleGameTimeout = () => {
  console.log('[Phase 2] 遊戲時間到')
  // 遊戲時間到後自動提交當前任務或跳過
  if (currentTask.value) {
    handleTaskSkipped()
  }
}

// 監聽 WebSocket 錯誤
watch(wsError, (newError) => {
  if (newError) {
    error.value = newError
    setTimeout(() => {
      error.value = null
    }, 5000)
  }
})

// 監聽打字通知
watch(roomState, (newState, oldState) => {
  // 檢測新成員加入或打字通知
  if (lobbyRef.value && newState && oldState) {
    // 可以在這裡處理其他狀態變化
  }
}, { deep: true })

// 清理
onUnmounted(() => {
  // 保留連線，因為可能需要重連
})
</script>
