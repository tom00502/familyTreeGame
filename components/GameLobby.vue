<template>
  <div class="min-h-screen bg-[#FAF8F3] flex flex-col p-6">
    <div class="w-full max-w-[390px] mx-auto flex flex-col gap-6 flex-1">
      <!-- 標題區 -->
      <div class="text-center space-y-2 pt-6">
        <div class="inline-flex items-center justify-center w-16 h-16 bg-[#8B2635] rounded-full border-4 border-[#D4AF37] shadow-lg">
          <div class="text-2xl text-[#FAF8F3]">族</div>
        </div>
        <h2 class="text-2xl font-bold text-[#5C2E2E]">{{ roomState?.roomName }}</h2>
        <div class="flex items-center justify-center gap-2 text-[#8B8278]">
          <span>房間代碼：</span>
          <span class="font-mono font-bold text-[#8B2635]">{{ roomId }}</span>
          <button
            @click="copyRoomId"
            class="p-1 hover:bg-[#8B2635]/10 rounded"
            title="複製"
          >
            📋
          </button>
        </div>
        <p class="text-[#8B8278] text-sm">
          遊戲時間：{{ roomState?.gameTime }} 秒
        </p>
      </div>

      <!-- 分享連結 -->
      <div class="bg-[#F5F1E8] p-4 rounded-lg border-2 border-[#8B8278]/20">
        <p class="text-xs text-[#8B8278] mb-2">分享此連結邀請家人加入：</p>
        <div class="flex gap-2">
          <input
            :value="shareLink"
            readonly
            class="flex-1 px-3 py-2 bg-white rounded border border-[#8B8278]/30 text-sm text-[#5C2E2E] font-mono"
          />
          <button
            @click="copyShareLink"
            class="px-4 py-2 bg-[#8B2635] text-white rounded hover:bg-[#5C2E2E] transition-colors text-sm font-medium"
          >
            複製
          </button>
        </div>
      </div>

      <!-- 玩家列表 -->
      <div class="flex-1 space-y-3">
        <h3 class="font-bold text-[#5C2E2E] flex items-center gap-2">
          <span>等待中的家人</span>
          <span class="text-sm font-normal text-[#8B8278]">
            ({{ activePlayers.length }} 人)
          </span>
        </h3>

        <!-- 有人正在輸入提示 -->
        <div
          v-if="showTypingIndicator"
          class="flex items-center gap-2 p-3 bg-[#F5F1E8] rounded-lg border border-[#8B8278]/20"
        >
          <span class="text-xl animate-pulse">⌛</span>
          <span class="text-[#8B8278] text-sm">某位家人正在輸入資料中...</span>
        </div>

        <!-- 玩家卡片列表 -->
        <div class="space-y-2">
          <div
            v-for="player in roomState?.players"
            :key="player.playerId"
            class="flex items-center gap-3 p-4 rounded-lg border-2 transition-all"
            :class="
              player.isOffline
                ? 'bg-gray-100 border-gray-300 opacity-50'
                : 'bg-white border-[#8B2635]/20 hover:border-[#8B2635]/40'
            "
          >
            <!-- 頭像 -->
            <div class="w-12 h-12 rounded-full bg-[#8B2635]/10 flex items-center justify-center text-2xl">
              {{ player.gender === 'male' ? '👨' : '👩' }}
            </div>

            <!-- 資料 -->
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <span class="font-bold text-[#5C2E2E]">{{ player.name }}</span>
                <span
                  v-if="isPlayerOwner(player.playerId)"
                  class="px-2 py-0.5 bg-[#D4AF37] text-[#5C2E2E] text-xs rounded font-medium"
                >
                  👑 房主
                </span>
                <span
                  v-if="player.isOffline"
                  class="text-xs text-gray-500"
                >
                  (離線)
                </span>
              </div>
              <div class="text-sm text-[#8B8278]">
                {{ player.gender === 'male' ? '男性' : '女性' }}
              </div>
            </div>

            <!-- 狀態 -->
            <div class="text-2xl">
              <span v-if="!player.isOffline">✅</span>
              <span v-else class="opacity-50">💤</span>
            </div>
          </div>

          <!-- 空狀態 -->
          <div
            v-if="!roomState?.players || roomState.players.length === 0"
            class="text-center py-8 text-[#8B8278]"
          >
            <p class="text-4xl mb-2">👋</p>
            <p>還沒有人加入，快分享連結邀請家人吧！</p>
          </div>
        </div>
      </div>

      <!-- 開始遊戲按鈕（僅房主可見） -->
      <div v-if="isOwner" class="sticky bottom-6 space-y-3">
        <div
          v-if="!canStartGame"
          class="text-center text-sm text-[#8B8278] bg-[#F5F1E8] p-3 rounded-lg"
        >
          ⚠️ 至少需要 2 位玩家才能開始遊戲
        </div>
        <button
          @click="handleStartGame"
          :disabled="!canStartGame"
          class="w-full py-4 rounded-md border-2 font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          :class="
            canStartGame
              ? 'bg-[#8B2635] text-[#FAF8F3] border-[#8B2635] hover:bg-[#5C2E2E]'
              : 'bg-[#F5F1E8] text-[#8B8278] border-[#8B8278]/30'
          "
        >
          開始遊戲
        </button>
      </div>

      <!-- 非房主的等待提示 -->
      <div v-else class="text-center text-[#8B8278] py-4">
        <p class="text-sm">等待房主開始遊戲...</p>
      </div>
    </div>

    <!-- Toast 通知 -->
    <div
      v-if="toast.show"
      class="fixed top-6 left-1/2 transform -translate-x-1/2 bg-[#5C2E2E] text-white px-6 py-3 rounded-lg shadow-lg z-50 transition-opacity"
    >
      {{ toast.message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RoomState } from '~/composables/useGameWebSocket'

const props = defineProps<{
  roomId: string
  roomState: RoomState | null
  isOwner: boolean
  currentPlayerId?: string
}>()

const emit = defineEmits<{
  startGame: []
}>()

const toast = ref({ show: false, message: '' })
const showTypingIndicator = ref(false)
let typingTimeout: NodeJS.Timeout | null = null

// 分享連結
const shareLink = computed(() => {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/room/${props.roomId}`
  }
  return ''
})

// 活躍玩家數量
const activePlayers = computed(() => {
  return props.roomState?.players.filter(p => !p.isOffline && !p.isObserver) || []
})

// 是否可以開始遊戲
const canStartGame = computed(() => {
  return activePlayers.value.length >= 2
})

// 判斷是否為房主
const isPlayerOwner = (playerId: string) => {
  // 第一位玩家為房主
  const players = props.roomState?.players || []
  return players.length > 0 && players[0].playerId === playerId
}

// 複製房間代碼
const copyRoomId = async () => {
  try {
    await navigator.clipboard.writeText(props.roomId)
    showToast('房間代碼已複製')
  } catch (err) {
    console.error('複製失敗:', err)
  }
}

// 複製分享連結
const copyShareLink = async () => {
  try {
    await navigator.clipboard.writeText(shareLink.value)
    showToast('分享連結已複製')
  } catch (err) {
    console.error('複製失敗:', err)
  }
}

// 顯示 Toast
const showToast = (message: string) => {
  toast.value = { show: true, message }
  setTimeout(() => {
    toast.value.show = false
  }, 2000)
}

// 開始遊戲
const handleStartGame = () => {
  if (canStartGame.value) {
    emit('startGame')
  }
}

// 監聽打字通知
const handleTypingNotify = () => {
  showTypingIndicator.value = true
  
  if (typingTimeout) clearTimeout(typingTimeout)
  
  typingTimeout = setTimeout(() => {
    showTypingIndicator.value = false
  }, 3000)
}

// 暴露方法供父組件調用
defineExpose({
  handleTypingNotify,
})
</script>
