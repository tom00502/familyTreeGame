<template>
<div class="min-h-screen bg-[#FAF8F3] flex flex-col">
    <!-- 頂部標題列 -->
    <div class="bg-white border-b border-[#8B8278]/20 px-4 py-3 flex items-center gap-3 shadow-sm">
        <span class="bg-[#8B8278] text-white text-xs font-bold px-3 py-1 rounded-full">
            👁️ 旁觀者模式
        </span>
        <h1 class="text-[#5C2E2E] font-bold text-lg flex-1">{{ data.roomName }}</h1>
        <span class="text-[#8B8278] text-sm">
            {{ statusLabel }}
        </span>
    </div>

    <!-- 主體：左右並排（桌機）/ 上下堆疊（行動） -->
    <div class="flex-1 flex flex-col md:flex-row overflow-hidden">
        <!-- ───────────────────────────────────────────────
           左側：答題監測區塊
      ─────────────────────────────────────────────── -->
        <div class="w-full md:w-[40%] flex flex-col border-r border-[#8B8278]/20 overflow-hidden">
            <!-- 玩家狀態列表 -->
            <div class="p-4 border-b border-[#8B8278]/15">
                <h2 class="text-sm font-bold text-[#5C2E2E] mb-3 flex items-center gap-2">
                    <span>📋</span> 答題監測
                </h2>
                <div class="space-y-2">
                    <div v-for="player in data.players" :key="player.playerId"
                        class="bg-white rounded-lg border border-[#8B8278]/20 px-3 py-2">
                        <div class="flex items-center gap-2">
                            <!-- 連線狀態燈 -->
                            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                :class="player.isOffline ? 'bg-red-400' : 'bg-green-400'"
                                :title="player.isOffline ? '離線' : '在線'"></span>
                            <span class="font-medium text-[#5C2E2E] text-sm flex-1 truncate">{{ player.name }}</span>
                            <!-- 進度 -->
                            <span v-if="player.totalQuestions > 0"
                                class="text-xs text-[#8B8278] bg-[#FAF8F3] px-1.5 py-0.5 rounded">
                                {{ player.answeredCount }}/{{ player.totalQuestions }}
                            </span>
                        </div>
                        <!-- 當前題目摘要 -->
                        <p v-if="player.currentQuestionSummary && !player.isOffline"
                            class="text-xs text-[#8B8278] mt-1 ml-4 truncate">
                            {{ player.currentQuestionSummary }}
                        </p>
                        <p v-else-if="player.isOffline" class="text-xs text-red-400 mt-1 ml-4">連線中斷</p>
                        <p v-else-if="player.answeredCount > 0 && player.answeredCount >= player.totalQuestions"
                            class="text-xs text-green-600 mt-1 ml-4">
                            ✅ 已完成所有問題
                        </p>
                    </div>
                    <p v-if="data.players.length === 0" class="text-xs text-[#8B8278] text-center py-2">
                        遊戲即將開始，等待玩家答題中...
                    </p>
                </div>
            </div>

            <!-- 答題歷史紀錄（可滾動） -->
            <div class="flex-1 overflow-y-auto p-4">
                <h2
                    class="text-sm font-bold text-[#5C2E2E] mb-3 flex items-center gap-2 sticky top-0 bg-[#FAF8F3] pb-1">
                    <span>📜</span> 答題歷史
                    <span class="ml-auto text-xs font-normal text-[#8B8278]">最近 {{ data.answerHistory.length }} 筆</span>
                </h2>

                <div v-if="data.answerHistory.length === 0" class="text-center py-8">
                    <p class="text-[#8B8278] text-sm">尚無答題紀錄</p>
                </div>

                <div class="space-y-1.5">
                    <div v-for="rec in data.answerHistory" :key="rec.timestamp + rec.playerId"
                        class="flex items-start gap-2 bg-white rounded-lg border px-3 py-2 text-xs transition-all"
                        :class="[
                            rec.status === 'confirmed'
                                ? 'border-green-200'
                                : 'border-[#8B8278]/20',
                            newEntryKeys.has(rec.timestamp + rec.playerId) ? 'ring-2 ring-[#D4AF37]' : '',
                        ]">
                        <span class="flex-shrink-0 mt-0.5" :title="rec.status === 'confirmed' ? '確認' : '跳過'">{{
                            rec.status === 'confirmed' ? '✅' : '⏭️' }}</span>
                        <div class="flex-1 min-w-0">
                            <span class="font-medium text-[#5C2E2E]">{{ rec.playerName }}</span>
                            <span class="text-[#8B8278] mx-1">·</span>
                            <span class="text-[#5C2E2E]">{{ rec.summary }}</span>
                        </div>
                        <time class="text-[#8B8278] flex-shrink-0">{{ formatTime(rec.timestamp) }}</time>
                    </div>
                </div>
            </div>
        </div>

        <!-- ───────────────────────────────────────────────
           右側：即時族譜區塊
      ─────────────────────────────────────────────── -->
        <div class="flex-1 flex flex-col overflow-hidden p-4">
            <h2 class="text-sm font-bold text-[#5C2E2E] mb-3 flex items-center gap-2">
                <span>🌳</span> 即時族譜
            </h2>

            <!-- 族譜完整度進度條 -->
            <div v-if="data.mvft" class="mb-3">
                <div class="flex justify-between text-xs mb-1">
                    <span class="text-[#8B8278]">族譜完整度</span>
                    <span class="font-medium" :style="{ color: progressColor }">
                        {{ confirmedNodeCount }} / {{ data.mvft.nodes.length }} 節點確認
                    </span>
                </div>
                <div class="h-2 rounded-full bg-[#8B8278]/20 overflow-hidden">
                    <div class="h-full rounded-full transition-all duration-700"
                        :style="{ width: `${completenessPercent}%`, backgroundColor: progressColor }"></div>
                </div>
            </div>

            <!-- 統計列 -->
            <div v-if="data.mvft" class="grid grid-cols-3 gap-2 mb-3 text-center">
                <div class="bg-white rounded-lg border border-[#8B8278]/20 py-2 px-1">
                    <div class="text-lg font-bold text-[#8B2635]">{{ playerNodeCount }}</div>
                    <div class="text-xs text-[#8B8278]">玩家節點</div>
                </div>
                <div class="bg-white rounded-lg border border-[#8B8278]/20 py-2 px-1">
                    <div class="text-lg font-bold text-[#8B8278]">{{ virtualNodeCount }}</div>
                    <div class="text-xs text-[#8B8278]">虛擬節點</div>
                </div>
                <div class="bg-white rounded-lg border border-[#8B8278]/20 py-2 px-1">
                    <div class="text-lg font-bold text-[#D4AF37]">{{ data.mvft.edges.length }}</div>
                    <div class="text-xs text-[#8B8278]">關係連線</div>
                </div>
            </div>

            <!-- Vue Flow 族譜圖 -->
            <div v-if="data.mvft && data.mvft.nodes.length > 0"
                class="flex-1 rounded-xl border border-[#8B8278]/20 bg-white shadow-inner overflow-hidden">
                <VueFlow :nodes="flowNodes" :edges="flowEdges" :node-types="nodeTypes" fit-view-on-init :min-zoom="0.3"
                    :max-zoom="2" class="family-flow">
                    <Background pattern-color="#8B8278" :gap="24" :size="1" :opacity="0.15" />
                    <Controls position="top-right" />
                </VueFlow>
            </div>

            <!-- 族譜尚未生成 -->
            <div v-else
                class="flex-1 flex items-center justify-center bg-white rounded-xl border border-[#8B8278]/20 min-h-[200px]">
                <div class="text-center space-y-2">
                    <div class="text-3xl">🌳</div>
                    <p class="text-[#8B8278] text-sm">族譜建構尚未開始</p>
                    <p class="text-[#8B8278] text-xs">等待玩家完成關係確認後顯示</p>
                </div>
            </div>
        </div>
    </div>
</div>
</template>

<script setup lang="ts">
import { markRaw } from 'vue'
import { VueFlow, MarkerType } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import dagre from 'dagre'
import type { SpectatorState, SpectatorAnswerRecord } from '~/composables/useGameWebSocket'
import type { MvftDisplayNode, MvftDisplayEdge } from '~/composables/useGameWebSocket'
import MemberCard from './MemberCard.vue'

interface Props {
    data: SpectatorState
}

const props = defineProps<Props>()

// ── 狀態標籤 ───────────────────────────────────
const statusLabel = computed(() => {
    switch (props.data.roomStatus) {
        case 'relationship-scan': return '⏳ 關係確認中'
        case 'in-game': return '🎮 遊戲進行中'
        case 'finished': return '🎉 遊戲結束'
        default: return '等待中'
    }
})

// ── 新進紀錄高亮（2 秒後淡出）─────────────────
const newEntryKeys = ref<Set<string>>(new Set())
const highlightedNodeIds = ref<Set<string>>(new Set())

watch(
    () => props.data.answerHistory[0],
    (latest) => {
        if (!latest) return
        const key = latest.timestamp + latest.playerId
        newEntryKeys.value.add(key)
        setTimeout(() => newEntryKeys.value.delete(key), 2000)
    }
)

// ── 監聽 MVFT 節點變化，高亮新節點 ───────────
const prevNodeIds = ref<Set<string>>(new Set())
watch(
    () => props.data.mvft?.nodes.map(n => n.id).join(','),
    (cur, prev) => {
        if (!props.data.mvft) return
        const curIds = new Set(props.data.mvft.nodes.map(n => n.id))
        curIds.forEach(id => {
            if (!prevNodeIds.value.has(id)) {
                highlightedNodeIds.value.add(id)
                setTimeout(() => highlightedNodeIds.value.delete(id), 2000)
            }
        })
        prevNodeIds.value = curIds
    }
)

// ── 族譜完整度 ─────────────────────────────────
const confirmedNodeCount = computed(() => props.data.mvft?.nodes.filter(n => !n.isVirtual).length ?? 0)
const playerNodeCount = computed(() => props.data.mvft?.nodes.filter(n => n.isPlayer).length ?? 0)
const virtualNodeCount = computed(() => props.data.mvft?.nodes.filter(n => n.isVirtual).length ?? 0)
const completenessPercent = computed(() => {
    const total = props.data.mvft?.nodes.length ?? 0
    if (total === 0) return 0
    return Math.round((confirmedNodeCount.value / total) * 100)
})
const progressColor = computed(() => {
    const p = completenessPercent.value
    if (p >= 70) return '#8B2635'
    if (p >= 40) return '#D4AF37'
    return '#8B8278'
})

// ── 自訂節點類型 ─────────────────────────────
const nodeTypes = { member: markRaw(MemberCard) }

// ── Dagre 佈局 ───────────────────────────────
const NODE_WIDTH = 160
const NODE_HEIGHT = 64

/**
 * 使用 dagre（僅根據親子邊排版）計算每個節點的座標。
 * 配偶邊不納入 dagre，避免破壞層次結構。
 */
const dagrePositions = computed((): Map<string, { x: number; y: number }> => {
    const mvft = props.data.mvft
    if (!mvft) return new Map()

    const { nodes, edges } = mvft
    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'TB', nodesep: 70, ranksep: 90, marginx: 40, marginy: 40 })

    for (const n of nodes) {
        g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
    }
    for (const e of edges) {
        if (e.type === 'parent') {
            g.setEdge(e.from, e.to)
        }
    }

    dagre.layout(g)

    const map = new Map<string, { x: number; y: number }>()
    for (const n of nodes) {
        const pos = g.node(n.id)
        if (pos) {
            map.set(n.id, {
                x: pos.x - NODE_WIDTH / 2,
                y: pos.y - NODE_HEIGHT / 2,
            })
        } else {
            // 孤立節點（無任何親子邊）放到左上角並垂直堆疊
            map.set(n.id, { x: 20, y: 20 + map.size * (NODE_HEIGHT + 20) })
        }
    }
    return map
})

// ── Vue Flow Nodes ───────────────────────────
const flowNodes = computed(() => {
    const mvft = props.data.mvft
    if (!mvft) return []

    return mvft.nodes.map(n => ({
        id: n.id,
        type: 'member',
        position: dagrePositions.value.get(n.id) ?? { x: 0, y: 0 },
        data: {
            label: n.label,
            avatar: genderEmoji(n),
            isVirtual: n.isVirtual,
            isPlayer: n.isPlayer,
            gender: n.gender,
            isHighlighted: highlightedNodeIds.value.has(n.id),
        },
    }))
})

// ── Vue Flow Edges ───────────────────────────
const flowEdges = computed(() => {
    const mvft = props.data.mvft
    if (!mvft) return []

    const positions = dagrePositions.value

    return mvft.edges.map((e, i) => {
        if (e.type === 'spouse') {
            // 根據 dagre 位置決定哪邊是「左」哪邊是「右」
            const fromPos = positions.get(e.from)
            const toPos = positions.get(e.to)
            const fromIsLeft = !fromPos || !toPos || fromPos.x <= toPos.x
            return {
                id: `edge-${i}`,
                source: e.from,
                target: e.to,
                sourceHandle: fromIsLeft ? 'right' : 'left',
                targetHandle: fromIsLeft ? 'left' : 'right',
                type: 'smoothstep',
                style: { stroke: '#D4AF37', strokeWidth: 2, strokeDasharray: '6,3' },
                label: e.label || '',
                labelStyle: { fill: '#8B8278', fontSize: 10 },
                labelBgStyle: { fill: 'rgba(250,248,243,0.85)', rx: 4, ry: 4 },
            }
        }

        // 親子關係：由上往下帶箭頭
        return {
            id: `edge-${i}`,
            source: e.from,
            target: e.to,
            sourceHandle: 'bottom',
            targetHandle: 'top',
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed, color: '#5C2E2E', width: 16, height: 16 },
            style: { stroke: '#5C2E2E', strokeWidth: 2 },
            label: e.label || '',
            labelStyle: { fill: '#8B8278', fontSize: 10 },
            labelBgStyle: { fill: 'rgba(250,248,243,0.85)', rx: 4, ry: 4 },
        }
    })
})

// ── 輔助函式 ──────────────────────────────────
function genderEmoji(node: MvftDisplayNode): string {
    if (node.gender === 'male') return '👨'
    if (node.gender === 'female') return '👩'
    return '👤'
}
function formatTime(ts: number): string {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}
</script>

<style scoped>
.family-flow {
    width: 100%;
    height: 100%;
}

/* 覆蓋 vue-flow 預設背景色，與設計系統保持一致 */
.family-flow :deep(.vue-flow__pane) {
    background: #ffffff;
}

.family-flow :deep(.vue-flow__controls) {
    border: 1px solid rgba(139, 130, 120, 0.3);
    border-radius: 8px;
    overflow: hidden;
}

.family-flow :deep(.vue-flow__controls-button) {
    background: #FAF8F3;
    border-bottom: 1px solid rgba(139, 130, 120, 0.2);
    color: #5C2E2E;
}

.family-flow :deep(.vue-flow__controls-button:hover) {
    background: #D4AF37;
    color: white;
}

.family-flow :deep(.vue-flow__edge-label) {
    pointer-events: none;
}
</style>
