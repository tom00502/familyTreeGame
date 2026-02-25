<template>
<div class="min-h-screen bg-[#FAF8F3] flex flex-col items-center justify-center p-6">
  <!-- 裝飾性雲紋背景 -->
  <div class="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-[#8B2635]/5 to-transparent" />

  <div class="w-full max-w-[390px] flex flex-col items-center gap-8 relative z-10">
    <!-- Logo -->
    <div
      class="w-24 h-24 bg-[#8B2635] rounded-full flex items-center justify-center border-4 border-[#D4AF37] shadow-lg">
      <div class="text-4xl text-[#FAF8F3]">族</div>
    </div>

    <!-- 主標題 -->
    <div class="text-center space-y-3">
      <h1 class="text-3xl font-bold text-[#5C2E2E]">一起拼出我們的家族樹</h1>
      <p class="text-[#8B8278]">適合家庭聚會・全員一起玩的互動遊戲</p>
    </div>

    <!-- 房間名稱輸入 -->
    <div class="w-full space-y-3">
      <label class="block text-[#5C2E2E] text-center font-medium">遊戲房間名稱</label>
      <input v-model="roomName" type="text" placeholder="例如：王家族譜、春節團圓..."
        class="w-full py-3 px-4 rounded-md border-2 border-[#8B8278]/30 bg-[#F5F1E8] text-[#5C2E2E] placeholder:text-[#8B8278]/50 focus:outline-none focus:border-[#8B2635] transition-colors"
        maxlength="20" />
    </div>

    <!-- 遊戲時間選擇 -->
    <div class="w-full space-y-3">
      <label class="block text-[#5C2E2E] text-center font-medium">請選擇遊戲秒數</label>
      <div class="grid grid-cols-3 gap-3">
        <button v-for="duration in [90, 120, 180]" :key="duration" @click="selectedDuration = duration"
          class="py-3 rounded-md border-2 transition-all font-medium" :class="selectedDuration === duration
              ? 'bg-[#8B2635] text-[#FAF8F3] border-[#D4AF37]'
              : 'bg-[#F5F1E8] text-[#8B2635] border-[#8B8278]/30 hover:border-[#8B2635]'
            ">
          {{ duration }} 秒
        </button>
      </div>
    </div>

    <!-- 錯誤提示 -->
    <div v-if="error" class="w-full p-3 bg-red-100 border border-red-300 rounded-md text-red-700 text-sm">
      {{ error }}
    </div>

    <!-- 建立按鈕 -->
    <button @click="handleCreateRoom" :disabled="!canCreate || isCreating"
      class="w-full py-4 rounded-md border-2 font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      :class="canCreate && !isCreating
          ? 'bg-transparent text-[#8B2635] border-[#8B2635] hover:bg-[#8B2635] hover:text-[#FAF8F3]'
          : 'bg-[#F5F1E8] text-[#8B8278] border-[#8B8278]/30'
        ">
      {{ isCreating ? '建立中...' : '創建你的家庭族譜' }}
    </button>

    <!-- 或加入現有房間 -->
    <div class="w-full text-center">
      <p class="text-[#8B8278] text-sm">
        已有房間代碼？
        <button @click="showJoinDialog = true" class="text-[#8B2635] font-medium underline hover:text-[#5C2E2E]">
          直接加入
        </button>
      </p>
    </div>
  </div>

  <!-- 裝飾性底部 -->
  <div class="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#8B2635]/5 to-transparent" />

  <!-- 加入房間對話框 -->
  <div v-if="showJoinDialog" class="fixed inset-0 bg-black/50 flex items-center justify-center p-6 z-50"
    @click.self="showJoinDialog = false">
    <div class="bg-[#FAF8F3] rounded-lg p-6 w-full max-w-sm space-y-4">
      <h3 class="text-xl font-bold text-[#5C2E2E]">加入房間</h3>
      <input v-model="joinRoomId" type="text" placeholder="輸入房間代碼"
        class="w-full py-3 px-4 rounded-md border-2 border-[#8B8278]/30 bg-[#F5F1E8] text-[#5C2E2E] placeholder:text-[#8B8278]/50 focus:outline-none focus:border-[#8B2635]"
        maxlength="8" />
      <div class="flex gap-3">
        <button @click="showJoinDialog = false"
          class="flex-1 py-2 rounded-md border-2 border-[#8B8278]/30 text-[#8B8278] hover:bg-[#F5F1E8]">
          取消
        </button>
        <button @click="handleJoinRoom" :disabled="!joinRoomId.trim()"
          class="flex-1 py-2 rounded-md bg-[#8B2635] text-[#FAF8F3] border-2 border-[#8B2635] hover:bg-[#5C2E2E] disabled:opacity-50">
          加入
        </button>
      </div>
    </div>
  </div>
</div>
</template>

<script setup lang="ts">
import { useGameWebSocket } from '~/composables/useGameWebSocket'

const router = useRouter()
const { connect, isConnected, createdRoomId, createRoom, error: wsError, clearError } = useGameWebSocket()

const roomName = ref('')
const selectedDuration = ref(120)
const isCreating = ref(false)
const error = ref<string | null>(null)
const showJoinDialog = ref(false)
const joinRoomId = ref('')

const canCreate = computed(() => roomName.value.trim().length >= 2)

// 建立 WebSocket 連線
onMounted(() => {
  connect()
})

// 監聽房間建立成功
watch(createdRoomId, (roomId) => {
  if (roomId) {
    // 導向房間頁面
    router.push(`/room/${roomId}`)
    isCreating.value = false
  }
})

// 建立房間
const handleCreateRoom = async () => {
  if (!canCreate.value || isCreating.value) return

  clearError()
  error.value = null
  isCreating.value = true

  try {
    // 等待連線建立
    if (!isConnected.value) {
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (isConnected.value) {
            clearInterval(checkInterval)
            resolve(true)
          }
        }, 100)

        // 5 秒超時
        setTimeout(() => {
          clearInterval(checkInterval)
          resolve(false)
        }, 5000)
      })
    }

    if (!isConnected.value) {
      error.value = '無法連線到伺服器，請稍後再試'
      isCreating.value = false
      return
    }

    // 發送建立房間請求
    createRoom(roomName.value.trim(), selectedDuration.value)

    // 設置超時：5秒內未收到 room:created 時顯示錯誤
    setTimeout(() => {
      if (isCreating.value) {
        error.value = '建立房間失敗，請重試'
        isCreating.value = false
      }
    }, 5000)
  } catch (err) {
    console.error('建立房間失敗:', err)
    error.value = '建立房間失敗，請重試'
    isCreating.value = false
  }
}

// 加入房間
const handleJoinRoom = () => {
  const roomId = joinRoomId.value.trim().toUpperCase()
  if (roomId) {
    router.push(`/room/${roomId}`)
  }
}

// 監聽 WebSocket 錯誤
watch(wsError, (newError) => {
  if (newError) {
    error.value = newError
  }
})
</script>
