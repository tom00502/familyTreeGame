<template>
  <div>
    <!-- 資料輸入階段 -->
    <PlayerInfoForm
      v-if="!hasJoined"
      :room-id="roomId"
      @submit="handlePlayerInfoSubmit"
      @typing="handleTyping"
    />

    <!-- 等待大廳階段 -->
    <GameLobby
      v-else
      ref="lobbyRef"
      :room-id="roomId"
      :room-state="roomState"
      :is-owner="isOwner"
      :current-player-id="currentPlayer?.playerId"
      @start-game="handleStartGame"
    />

    <!-- 錯誤提示 -->
    <div
      v-if="error"
      class="fixed top-6 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50"
    >
      {{ error }}
    </div>

    <!-- Loading -->
    <div
      v-if="isLoading"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <div class="bg-white rounded-lg p-6 flex flex-col items-center gap-4">
        <div class="w-12 h-12 border-4 border-[#8B2635] border-t-transparent rounded-full animate-spin"></div>
        <p class="text-[#5C2E2E]">{{ loadingMessage }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGameWebSocket } from '~/composables/useGameWebSocket'
import PlayerInfoForm from '~/components/PlayerInfoForm.vue'
import GameLobby from '~/components/GameLobby.vue'

const route = useRoute()
const router = useRouter()

const roomId = computed(() => route.params.id as string)

const {
  connect,
  isConnected,
  roomState,
  currentPlayer,
  isOwner,
  error: wsError,
  notifyTyping,
  joinRoom,
  startGame,
} = useGameWebSocket()

const hasJoined = ref(false)
const error = ref<string | null>(null)
const isLoading = ref(true)
const loadingMessage = ref('連線中...')
const lobbyRef = ref<InstanceType<typeof GameLobby> | null>(null)

// 建立連線
onMounted(async () => {
  try {
    // 檢查是否已有玩家資料
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
      if (roomState.value?.status === 'relationship-scan' || roomState.value?.status === 'in-game') {
        clearInterval(checkStarted)
        isLoading.value = false
        console.log('遊戲已開始')
        // TODO: 導向遊戲頁面
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
