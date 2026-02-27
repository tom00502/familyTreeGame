<template>
<div class="min-h-screen bg-[#FAF8F3] flex flex-col p-4">
    <!-- 標題列 -->
    <div class="text-center mb-4 space-y-1">
        <h1 class="text-2xl font-bold text-[#5C2E2E]">🌳 骨架族譜預覽</h1>
        <p class="text-[#8B8278] text-sm">
            根據玩家關係掃描自動生成 · {{ mvft.nodes.length }} 個節點 · {{ mvft.edges.length }} 條連線
        </p>
        <p class="text-xs text-[#D4AF37] font-medium">驗證模式：僅顯示骨架結構，非最終族譜</p>
    </div>

    <!-- 圖例 -->
    <div class="flex justify-center gap-6 mb-4 flex-wrap text-sm">
        <div class="flex items-center gap-2">
            <div class="w-5 h-5 rounded bg-[#8B2635] border-2 border-[#D4AF37]"></div>
            <span class="text-[#5C2E2E]">玩家節點（女）</span>
        </div>
        <div class="flex items-center gap-2">
            <div class="w-5 h-5 rounded bg-[#4A7C9E] border-2 border-[#D4AF37]"></div>
            <span class="text-[#5C2E2E]">玩家節點（男）</span>
        </div>
        <div class="flex items-center gap-2">
            <div class="w-5 h-5 rounded bg-[#FAF8F3] border-2 border-dashed border-[#8B8278]"></div>
            <span class="text-[#5C2E2E]">虛擬節點（待填充）</span>
        </div>
        <div class="flex items-center gap-2">
            <div class="w-5 h-5 rounded bg-[#6B5B4E] border-2 border-[#D4AF37]"></div>
            <span class="text-[#5C2E2E]">已確認節點</span>
        </div>
        <div class="flex items-center gap-2">
            <div class="w-8 h-0.5 bg-[#5C2E2E]"></div>
            <span class="text-[#5C2E2E]">親子關係</span>
        </div>
        <div class="flex items-center gap-2">
            <div class="w-8 border-t-2 border-dashed border-[#D4AF37]"></div>
            <span class="text-[#5C2E2E]">配偶關係</span>
        </div>
    </div>

    <!-- Vue Flow 族譜圖 -->
    <div class="rounded-xl border border-[#8B8278]/20 bg-white shadow-inner flow-container">
        <VueFlow :nodes="flowNodes" :edges="flowEdges" :node-types="nodeTypes" fit-view-on-init :min-zoom="0.3"
            :max-zoom="2" class="family-flow">
            <Background pattern-color="#8B8278" :gap="24" :size="1" :opacity="0.15" />
            <Controls position="top-right" />
        </VueFlow>
    </div>

    <!-- 統計資訊 -->
    <div class="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
        <div class="bg-white rounded-lg p-3 border border-[#8B8278]/20">
            <div class="text-2xl font-bold text-[#8B2635]">{{ playerNodeCount }}</div>
            <div class="text-[#8B8278]">玩家節點</div>
        </div>
        <div class="bg-white rounded-lg p-3 border border-[#8B8278]/20">
            <div class="text-2xl font-bold text-[#8B8278]">{{ virtualNodeCount }}</div>
            <div class="text-[#8B8278]">虛擬節點</div>
        </div>
        <div class="bg-white rounded-lg p-3 border border-[#8B8278]/20">
            <div class="text-2xl font-bold text-[#D4AF37]">{{ mvft.edges.length }}</div>
            <div class="text-[#8B8278]">關係連線</div>
        </div>
    </div>
</div>
</template>

<script setup lang="ts">
import { computed, markRaw } from 'vue'
import { VueFlow, MarkerType } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import dagre from 'dagre'
import MemberCard from './MemberCard.vue'

// ─── 型別定義（與 useGameWebSocket.ts 保持同步）─────────────────────
interface MvftDisplayNode {
    id: string
    label: string
    gender: 'male' | 'female' | 'unknown'
    isPlayer: boolean
    playerId?: string
    isVirtual: boolean
    birthday?: string
    isConfirmed?: boolean
}

interface MvftDisplayEdge {
    from: string
    to: string
    type: 'parent' | 'spouse'
    label: string
}

interface MvftData {
    nodes: MvftDisplayNode[]
    edges: MvftDisplayEdge[]
    generatedAt: number
}

interface Props {
    mvft: MvftData
}

const props = defineProps<Props>()

// ── 自訂節點類型 ─────────────────────────────
const nodeTypes = { member: markRaw(MemberCard) }

// ── 統計 ─────────────────────────────────────
const playerNodeCount = computed(() => props.mvft.nodes.filter(n => n.isPlayer).length)
const virtualNodeCount = computed(() => props.mvft.nodes.filter(n => n.isVirtual).length)

// ── 輔助函式 ─────────────────────────────────
function genderEmoji(node: MvftDisplayNode): string {
    if (node.gender === 'male') return '👨'
    if (node.gender === 'female') return '👩'
    return '👤'
}

// ── Dagre 佈局 ───────────────────────────────
const NODE_WIDTH = 160
const NODE_HEIGHT = 64

/**
 * 使用 dagre（僅根據親子邊排版）計算每個節點的座標。
 * 配偶邊不納入 dagre，避免破壞層次結構。
 * ★ 後處理：強制配偶節點同一 Y 軸高度（同層顯示）
 */
const dagrePositions = computed((): Map<string, { x: number; y: number }> => {
    const { nodes, edges } = props.mvft
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

    // ★ 後處理：配偶同層對齊
    // 遍歷所有配偶邊，強制兩端節點 Y 座標一致（取較小值，即較高的那層）
    for (const e of edges) {
        if (e.type === 'spouse') {
            const posA = map.get(e.from)
            const posB = map.get(e.to)
            if (posA && posB) {
                const alignedY = Math.min(posA.y, posB.y)
                posA.y = alignedY
                posB.y = alignedY
                // 確保配偶水平相鄰：如果 X 座標差距過小，稍微分開
                if (Math.abs(posA.x - posB.x) < NODE_WIDTH + 20) {
                    const midX = (posA.x + posB.x) / 2
                    posA.x = midX - NODE_WIDTH / 2 - 15
                    posB.x = midX + NODE_WIDTH / 2 + 15
                }
            }
        }
    }

    return map
})

// ── Vue Flow Nodes ───────────────────────────
const flowNodes = computed(() =>
    props.mvft.nodes.map(n => ({
        id: n.id,
        type: 'member',
        position: dagrePositions.value.get(n.id) ?? { x: 0, y: 0 },
        data: {
            label: n.label,
            avatar: genderEmoji(n),
            isVirtual: n.isVirtual,
            isPlayer: n.isPlayer,
            isConfirmed: n.isConfirmed ?? n.isPlayer,
            gender: n.gender,
            birthday: n.birthday,
        },
    }))
)

// ── Vue Flow Edges ───────────────────────────
const flowEdges = computed(() => {
    const positions = dagrePositions.value

    return props.mvft.edges.map((e, i) => {
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
</script>

<style scoped>
.flow-container {
    width: 100%;
    height: 60vh;
    min-height: 500px;
    position: relative;
}

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
