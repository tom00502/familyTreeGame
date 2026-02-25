<template>
<div>
    <!-- 除錯資訊：確認頁面已載入 -->
    <div class="fixed bottom-4 right-4 text-xs bg-gray-800 text-white px-3 py-2 rounded z-50 max-w-xs">
        <div>頁面: dashboard.vue</div>
        <div>roomId: {{ roomId }}</div>
        <div>spectatorState: {{ spectatorState ? '✓' : '✗' }}</div>
        <div>error: {{ error || wsError || 'none' }}</div>
    </div>

    <!-- 旁觀者看板 -->
    <SpectatorDashboard v-if="spectatorState" :data="spectatorState" />

    <!-- 載入中 -->
    <div v-else-if="!error" class="min-h-screen bg-[#FAF8F3] flex items-center justify-center">
        <div class="text-center space-y-4">
            <div
                class="w-16 h-16 mx-auto bg-[#8B2635] rounded-full flex items-center justify-center border-4 border-[#D4AF37] shadow-lg">
                <span class="text-2xl">👁️</span>
            </div>
            <h2 class="text-xl font-bold text-[#5C2E2E]">連線至旁觀者看板...</h2>
            <div class="w-8 h-8 border-4 border-[#8B2635] border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
    </div>

    <!-- 錯誤 -->
    <div v-else class="min-h-screen bg-[#FAF8F3] flex items-center justify-center p-6">
        <div class="text-center space-y-4">
            <div class="text-4xl">⚠️</div>
            <h2 class="text-xl font-bold text-[#5C2E2E]">{{ error }}</h2>
            <button
                class="px-6 py-2 bg-[#8B2635] text-white rounded-lg font-medium hover:bg-[#6B1C29] transition-colors"
                @click="router.push(`/room/${roomId}`)">
                返回房間
            </button>
        </div>
    </div>
</div>
</template>

<script setup lang="ts">
// 最早的日誌，確認頁面是否載入
console.log('[Dashboard] ========== dashboard.vue 腳本開始執行 ==========')

import SpectatorDashboard from '~/components/SpectatorDashboard.vue'
import { useGameWebSocket } from '~/composables/useGameWebSocket'

console.log('[Dashboard] 導入完成，開始初始化狀態')

const route = useRoute()
const router = useRouter()
const roomId = computed(() => route.params.id as string)

console.log('[Dashboard] route 和 router 已初始化')

const {
    connect,
    isConnected,
    isSpectator,
    spectatorState,
    watchRoom,
    error: wsError,
} = useGameWebSocket()

console.log('[Dashboard] useGameWebSocket 已初始化')

const error = ref<string | null>(null)

console.log('[Dashboard] 所有狀態已初始化，等待 onMounted')

// 等待連線後送出 spectator:watch
const initSpectator = async () => {
    console.log('[Dashboard] ========== 開始初始化旁觀者模式 ==========')
    console.log('[Dashboard] roomId:', roomId.value)

    // ① 建立 WebSocket 連線
    console.log('[Dashboard] ① 調用 connect()')
    console.log('[Dashboard] 調用前 - ws是否存在:', (window as any).__gameWS ? '已存在' : '不存在')
    connect()
    console.log('[Dashboard] connect()調用完成')

    // ② 等待連線建立（最長 5 秒）
    console.log('[Dashboard] ② 等待 WebSocket 連線建立...')
    const connected = await new Promise<boolean>((resolve) => {
        const maxAttempts = 50
        let attempts = 0
        const check = setInterval(() => {
            attempts++
            const currentState = isConnected.value
            if (attempts === 1 || attempts === 5 || attempts === 10 || attempts % 10 === 0) {
                console.log(`[Dashboard]    檢查 #${attempts}: isConnected=${currentState}`)
            }
            if (currentState) {
                console.log('[Dashboard] ✓ WebSocket 已連線（耗時 ' + (attempts * 100) + 'ms）')
                clearInterval(check)
                resolve(true)
            } else if (attempts >= maxAttempts) {
                console.log('[Dashboard] ✗ WebSocket 連線逾時（5秒）')
                clearInterval(check)
                resolve(false)
            }
        }, 100)
    })

    if (!connected) {
        error.value = '無法連線到伺服器'
        console.error('[Dashboard] 連線失敗:', error.value)
        console.log('[Dashboard] 當前 isConnected.value:', isConnected.value)
        return
    }

    // ③ 發送旁觀者進入請求
    console.log('[Dashboard] ③ 發送 watchRoom 請求，roomId:', roomId.value)
    console.log('[Dashboard] 發送前檢查：isConnected=', isConnected.value)
    watchRoom(roomId.value)
    console.log('[Dashboard] watchRoom() 調用完成')

    // ④ 等待伺服器回應（最長 5 秒）
    console.log('[Dashboard] ④ 等待 spectator:sync 消息...')
    const stateReceived = await new Promise<boolean>((resolve) => {
        const maxAttempts = 50
        let attempts = 0
        const check = setInterval(() => {
            attempts++
            const hasState = !!spectatorState.value
            const hasError = !!error.value || !!wsError.value
            if (attempts === 1 || attempts === 5 || attempts === 10 || attempts % 10 === 0) {
                console.log(`[Dashboard]    檢查 #${attempts}: spectatorState=${hasState}, error=${hasError ? wsError.value || error.value : 'none'}`)
            }
            // 檢查是否成功收到 spectatorState 或錯誤訊息
            if (hasState) {
                console.log('[Dashboard] ✓ 已收到 spectator:sync（耗時 ' + (attempts * 100) + 'ms）')
                console.log('[Dashboard] spectatorState 內容:', spectatorState.value)
                clearInterval(check)
                resolve(true)
            } else if (hasError) {
                console.log('[Dashboard] ✗ 收到錯誤訊息:', wsError.value || error.value)
                clearInterval(check)
                resolve(false)
            } else if (attempts >= maxAttempts) {
                console.log('[Dashboard] ✗ 等待 spectator:sync 逾時（5秒）')
                console.log('[Dashboard] 當前狀態 - spectatorState:', spectatorState.value, ', error:', error.value, ', wsError:', wsError.value)
                clearInterval(check)
                resolve(false)
            }
        }, 100)
    })

    if (!stateReceived) {
        // 如果已有錯誤訊息就不覆蓋
        if (!error.value) {
            error.value = wsError.value || '無法加入旁觀者模式，請重試'
            console.error('[Dashboard] 未能收到伺服器狀態:', error.value)
        }
    }

    console.log('[Dashboard] ========== 初始化完成 ==========')
}

// 同步伺服器錯誤訊息
watch(wsError, (val) => {
    if (val && !error.value) {
        error.value = val
    }
})

// 監聽旁觀者重導向（遊戲尚未開始）
watch(isSpectator, (val) => {
    // isSpectator 被設回 false 代表收到 spectator:redirect
    if (val === false && !spectatorState.value) {
        router.replace(`/room/${roomId.value}`)
    }
})

onMounted(() => {
    console.log('[Dashboard] ========== onMounted 觸發 ==========')
    console.log('[Dashboard] 當前 roomId:', roomId.value)
    console.log('[Dashboard] 當前狀態：isConnected=', isConnected.value, ', spectatorState=', !!spectatorState.value)
    initSpectator()
})
</script>
