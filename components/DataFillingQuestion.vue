<template>
<div class="min-h-screen bg-[#FAF8F3] flex flex-col p-6">
    <div class="w-full max-w-[390px] mx-auto flex flex-col gap-6 flex-1">
        <!-- 倒計時進度條 -->
        <div class="space-y-2">
            <div class="flex justify-between items-center text-sm">
                <span class="text-[#8B8278]">剩餘時間</span>
                <span v-if="playerName" class="font-medium text-[#5C2E2E]">🙋 {{ playerName }}</span>
                <span class="font-bold text-[#8B2635]">{{ remainingTime }}秒</span>
            </div>
            <div class="h-2 bg-[#F5F1E8] rounded-full overflow-hidden">
                <div class="h-full bg-gradient-to-r from-[#8B2635] to-[#D4AF37] transition-all duration-1000"
                    :style="{ width: `${progressPercentage}%` }"></div>
            </div>
        </div>

        <!-- EFU 進度 -->
        <div class="text-center space-y-2">
            <span class="text-xs text-[#8B8278]">EFU 完成度</span>
            <div class="h-1.5 bg-[#F5F1E8] rounded-full overflow-hidden">
                <div class="h-full bg-[#D4AF37] transition-all duration-500" :style="{ width: `${efuProgress}%` }">
                </div>
            </div>
        </div>

        <!-- 任務標題 -->
        <div class="text-center space-y-3">
            <div class="inline-block px-3 py-1 bg-[#D4AF37]/20 rounded-full text-xs font-bold text-[#8B2635]">
                {{ taskTypeLabel }}
            </div>
            <h2 class="text-2xl font-bold text-[#5C2E2E]">
                {{ questionTitle }}
            </h2>
            <p v-if="currentTask" class="text-sm text-[#8B8278]">
                {{ questionSubtitle }}
            </p>
        </div>

        <!-- 任務內容區域 -->
        <div class="flex-1 space-y-4">
            <!-- 1. 節點命名 (node-naming) -->
            <div v-if="currentTask?.type === 'node-naming'" class="space-y-4">
                <div class="space-y-2">
                    <label class="text-sm font-medium text-[#5C2E2E]">
                        <template v-if="(currentTask as any).knownSiblingNames?.length > 0">
                            「{{ (currentTask as any).parentName || currentTask.targetNodeLabel }}」的子女除了
                            {{ (currentTask as any).knownSiblingNames.join('、') }} 以外，還有誰？
                        </template>
                        <template v-else>
                            請輸入「{{ currentTask.targetNodeLabel }}」的名字：
                        </template>
                    </label>
                    <input v-model="answerInput" type="text" placeholder="例如：王大華"
                        class="w-full px-4 py-3 rounded-lg border-2 border-[#8B8278]/20 focus:border-[#8B2635] focus:outline-none text-[#5C2E2E]" />
                </div>
                <div v-if="(currentTask as any).knownSiblingNames?.length > 0" 
                     class="p-3 bg-[#FFF5F1] rounded-lg border border-[#D4AF37]/30 text-xs text-[#8B8278]">
                    👨‍👩‍👧‍👦 已知子女：{{ (currentTask as any).knownSiblingNames.join('、') }}
                </div>
            </div>

            <!-- 2. 屬性填充 (attribute-filling) -->
            <div v-else-if="currentTask?.type === 'attribute-filling'" class="space-y-4">
                <!-- 性別選擇 -->
                <div v-if="(currentTask as any).attributeType === 'gender'" class="space-y-3">
                    <label class="text-sm font-medium text-[#5C2E2E]">
                        {{ currentTask.targetNodeName }} 是：
                    </label>
                    <div class="space-y-2">
                        <button v-for="opt in genderOptions" :key="opt.value" @click="answerInput = opt.value"
                            class="w-full py-3 px-4 rounded-lg border-2 transition-all font-medium text-left" :class="answerInput === opt.value
                                    ? 'bg-[#8B2635] text-white border-[#D4AF37]'
                                    : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:bg-[#F5F1E8]'
                                ">
                            {{ opt.label }}
                        </button>
                    </div>
                </div>

                <!-- 生日選擇 -->
                <div v-else-if="(currentTask as any).attributeType === 'birthday'" class="space-y-2">
                    <label class="text-sm font-medium text-[#5C2E2E]">
                        {{ currentTask.targetNodeName }} 的出生日期：
                    </label>
                    <input v-model="answerInput" type="date"
                        class="w-full px-4 py-3 rounded-lg border-2 border-[#8B8278]/20 focus:border-[#8B2635] focus:outline-none text-[#5C2E2E]" />
                </div>
            </div>

            <!-- 3. 向上追溯 (upward-tracing) -->
            <div v-else-if="currentTask?.type === 'upward-tracing'" class="space-y-4">
                <div class="space-y-2">
                    <label class="text-sm font-medium text-[#5C2E2E]">
                        {{ currentTask.targetNodeName }} 的
                        {{ (currentTask as any).parentType === 'father' ? '爸爸' : '媽媽' }}
                        叫什麼名字？
                    </label>
                    <input v-model="answerInput" type="text" placeholder="例如：王志遠"
                        class="w-full px-4 py-3 rounded-lg border-2 border-[#8B8278]/20 focus:border-[#8B2635] focus:outline-none text-[#5C2E2E]" />
                </div>
                <div class="p-3 bg-[#FFF5F1] rounded-lg border border-[#D4AF37]/30 text-xs text-[#8B2635]">
                    💡 家族成員無須記得完整名字，大名或暱稱均可
                </div>
            </div>

            <!-- 4. 節點匯聚 (node-convergence) -->
            <div v-else-if="currentTask?.type === 'node-convergence'" class="space-y-4">
                <div class="space-y-3">
                    <p class="text-sm font-medium text-[#5C2E2E]">
                        「{{ (currentTask as any).targetNodeName }}」和「{{ (currentTask as any).candidateNodeName }}」
                        是同一個人嗎？
                    </p>
                    <div class="grid grid-cols-2 gap-3">
                        <button @click="answerInput = 'yes'"
                            class="py-3 px-4 rounded-lg border-2 transition-all font-medium" :class="answerInput === 'yes'
                                    ? 'bg-[#8B2635] text-white border-[#D4AF37]'
                                    : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:bg-[#F5F1E8]'
                                ">
                            是同一人
                        </button>
                        <button @click="answerInput = 'no'"
                            class="py-3 px-4 rounded-lg border-2 transition-all font-medium" :class="answerInput === 'no'
                                    ? 'bg-[#8B2635] text-white border-[#D4AF37]'
                                    : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:bg-[#F5F1E8]'
                                ">
                            不是同一人
                        </button>
                    </div>
                </div>
            </div>

            <!-- 5. 配偶詢問 (lateral-inquiry) -->
            <div v-else-if="currentTask?.type === 'lateral-inquiry'" class="space-y-4">
                <div class="space-y-3">
                    <label class="text-sm font-medium text-[#5C2E2E]">
                        {{ (currentTask as any).targetNodeName }} 有結婚嗎？（或有配偶/伴侶？）
                    </label>
                    <div class="space-y-2">
                        <button @click="answerInput = 'yes'"
                            class="w-full py-3 px-4 rounded-lg border-2 transition-all font-medium text-left"
                            :class="answerInput === 'yes'
                                ? 'bg-[#8B2635] text-white border-[#D4AF37]'
                                : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:bg-[#F5F1E8]'
                            ">
                            💍 有配偶
                        </button>
                        <button @click="answerInput = 'no'"
                            class="w-full py-3 px-4 rounded-lg border-2 transition-all font-medium text-left"
                            :class="answerInput === 'no'
                                ? 'bg-[#8B2635] text-white border-[#D4AF37]'
                                : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:bg-[#F5F1E8]'
                            ">
                            🚫 沒有配偶
                        </button>
                    </div>
                </div>
            </div>

            <!-- 6. 子女詢問 (downward-inquiry) -->
            <div v-else-if="currentTask?.type === 'downward-inquiry'" class="space-y-4">
                <div class="space-y-3">
                    <label class="text-sm font-medium text-[#5C2E2E]">
                        <template v-if="(currentTask as any).knownChildrenCount > 0">
                            {{ (currentTask as any).targetNodeName }} 目前已知有 {{ (currentTask as any).knownChildrenCount }} 位子女
                            <span v-if="(currentTask as any).knownChildrenNames?.length > 0">
                                （{{ (currentTask as any).knownChildrenNames.join('、') }}）
                            </span>
                            ，還有其他子女嗎？
                        </template>
                        <template v-else>
                            {{ (currentTask as any).targetNodeName }} 有幾個小孩？
                        </template>
                    </label>
                    <!-- 無已知子女模式：直接選數量或沒有 -->
                    <template v-if="(currentTask as any).knownChildrenCount === 0">
                        <div class="space-y-2">
                            <button @click="answerInput = 'no'; childrenCountInput = null"
                                class="w-full py-3 px-4 rounded-lg border-2 transition-all font-medium text-left"
                                :class="answerInput === 'no'
                                    ? 'bg-[#8B2635] text-white border-[#D4AF37]'
                                    : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:bg-[#F5F1E8]'
                                ">
                                🚫 沒有小孩
                            </button>
                            <div class="flex items-center justify-center gap-4 py-2"
                                @click="if (!childrenCountInput) { childrenCountInput = 1; answerInput = 'has_children' }">
                                <span class="text-sm text-[#5C2E2E] whitespace-nowrap">👶 有</span>
                                <button @click.stop="decrementChildren('has_children')"
                                    :disabled="!childrenCountInput || childrenCountInput <= 1"
                                    class="w-10 h-10 rounded-full border-2 border-[#8B8278]/20 flex items-center justify-center text-lg font-bold text-[#5C2E2E] hover:bg-[#F5F1E8] disabled:opacity-30 transition-all">
                                    −
                                </button>
                                <span class="text-3xl font-bold min-w-[2.5rem] text-center"
                                    :class="childrenCountInput ? 'text-[#8B2635]' : 'text-[#8B8278]/40'">{{ childrenCountInput || 0 }}</span>
                                <button @click.stop="incrementChildren('has_children')"
                                    class="w-10 h-10 rounded-full border-2 border-[#8B8278]/20 flex items-center justify-center text-lg font-bold text-[#5C2E2E] hover:bg-[#F5F1E8] transition-all">
                                    +
                                </button>
                                <span class="text-sm text-[#5C2E2E]">個小孩</span>
                            </div>
                        </div>
                    </template>
                    <!-- 已知有子女模式：問還有沒有其他 -->
                    <template v-else>
                        <div class="space-y-2">
                            <button @click="answerInput = 'no_more'; childrenCountInput = null"
                                class="w-full py-3 px-4 rounded-lg border-2 transition-all font-medium text-left"
                                :class="answerInput === 'no_more'
                                    ? 'bg-[#8B2635] text-white border-[#D4AF37]'
                                    : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:bg-[#F5F1E8]'
                                ">
                                ✅ 沒有其他子女了
                            </button>
                            <div class="flex items-center justify-center gap-4 py-2"
                                @click="if (!childrenCountInput) { childrenCountInput = 1; answerInput = 'has_more' }">
                                <span class="text-sm text-[#5C2E2E] whitespace-nowrap">👶 還有</span>
                                <button @click.stop="decrementChildren('has_more')"
                                    :disabled="!childrenCountInput || childrenCountInput <= 1"
                                    class="w-10 h-10 rounded-full border-2 border-[#8B8278]/20 flex items-center justify-center text-lg font-bold text-[#5C2E2E] hover:bg-[#F5F1E8] disabled:opacity-30 transition-all">
                                    −
                                </button>
                                <span class="text-3xl font-bold min-w-[2.5rem] text-center"
                                    :class="childrenCountInput ? 'text-[#8B2635]' : 'text-[#8B8278]/40'">{{ childrenCountInput || 0 }}</span>
                                <button @click.stop="incrementChildren('has_more')"
                                    class="w-10 h-10 rounded-full border-2 border-[#8B8278]/20 flex items-center justify-center text-lg font-bold text-[#5C2E2E] hover:bg-[#F5F1E8] transition-all">
                                    +
                                </button>
                                <span class="text-sm text-[#5C2E2E]">位</span>
                            </div>
                        </div>
                    </template>
                </div>
            </div>

            <!-- 不支援的任務類型 -->
            <div v-else class="text-center text-[#8B8278]">
                不支援此任務類型：{{ currentTask?.type }}
            </div>
        </div>

        <!-- 底部按鈕 -->
        <div class="space-y-3 mt-auto">
            <button @click="skipTask" :disabled="isLoading"
                class="w-full py-3 text-[#8B8278] hover:text-[#5C2E2E] disabled:opacity-50 transition-colors font-medium">
                {{ `跳過此題 (${skippedCount || 0}/3)` }}
            </button>
            <button @click="confirmAnswer" :disabled="!canConfirm || isLoading"
                class="w-full py-4 rounded-lg font-bold text-lg transition-all shadow-md" :class="canConfirm && !isLoading
                        ? 'bg-[#8B2635] text-white hover:bg-[#5C2E2E] active:scale-95'
                        : 'bg-[#8B8278]/30 text-[#8B8278] cursor-not-allowed'
                    ">
                {{ isLoading ? '提交中...' : '提交答案' }}
            </button>
        </div>
    </div>
</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { Phase2Task } from '~/server/utils/gameState'

interface Props {
    currentTask: Phase2Task | null
    timeLimit?: number
    efuProgress?: number
    skippedCount?: number
    playerName?: string
}

const props = withDefaults(defineProps<Props>(), {
    timeLimit: 180,
    efuProgress: 0,
    skippedCount: 0,
    playerName: '',
})

const emit = defineEmits<{
    'answer-submitted': [answer: any]
    'task-skipped': []
    'time-expired': []
}>()

// 倒計時
const remainingTime = ref(props.timeLimit)
let timerInterval: ReturnType<typeof setInterval> | null = null

const progressPercentage = computed(() => {
    return (remainingTime.value / props.timeLimit) * 100
})

// 答案輸入
const answerInput = ref('')
const childrenCountInput = ref<number | null>(null)
const isLoading = ref(false)

// 加減按鈕 helpers
function incrementChildren(mode: 'has_children' | 'has_more') {
    if (!childrenCountInput.value) {
        childrenCountInput.value = 1
    } else {
        childrenCountInput.value = Math.min(20, childrenCountInput.value + 1)
    }
    answerInput.value = mode
}

function decrementChildren(mode: 'has_children' | 'has_more') {
    if (childrenCountInput.value && childrenCountInput.value > 1) {
        childrenCountInput.value--
        answerInput.value = mode
    }
}

const canConfirm = computed(() => {
    if (!props.currentTask || isLoading.value) return false

    if (props.currentTask.type === 'node-naming' || props.currentTask.type === 'upward-tracing') {
        return answerInput.value.trim().length > 0
    }

    if (props.currentTask.type === 'attribute-filling') {
        return answerInput.value !== ''
    }

    if (props.currentTask.type === 'node-convergence') {
        return ['yes', 'no'].includes(answerInput.value)
    }

    if (props.currentTask.type === 'lateral-inquiry') {
        return ['yes', 'no'].includes(answerInput.value)
    }

    if (props.currentTask.type === 'downward-inquiry') {
        if (answerInput.value === 'no' || answerInput.value === 'no_more') return true
        if ((answerInput.value === 'has_children' || answerInput.value === 'has_more') && childrenCountInput.value && childrenCountInput.value > 0) return true
        return false
    }

    return false
})

// 性別選項
const genderOptions = [
    { value: 'male', label: '男性' },
    { value: 'female', label: '女性' },
    { value: 'unknown', label: '不確定' },
]

// 任務标签和标题
const taskTypeLabel = computed(() => {
    if (!props.currentTask) return ''
    const labels: Record<string, string> = {
        'node-naming': '節點命名',
        'attribute-filling': '屬性填充',
        'upward-tracing': '向上追溯',
        'node-convergence': '節點匯聚',
        'age-ordering': '排序確認',
        'lateral-inquiry': '配偶確認',
        'downward-inquiry': '子女確認',
    }
    return labels[props.currentTask.type] || 'Unknown'
})

const questionTitle = computed(() => {
    if (!props.currentTask) return ''

    switch (props.currentTask.type) {
        case 'node-naming': {
            const task = props.currentTask as any
            if (task.knownSiblingNames?.length > 0) {
                return `「${task.parentName || task.targetNodeLabel}」還有哪個子女？`
            }
            return `「${props.currentTask.targetNodeLabel}」的名字是？`
        }
        case 'attribute-filling':
            return `「${props.currentTask.targetNodeName}」的資訊`
        case 'upward-tracing':
            return `「${props.currentTask.targetNodeName}」的父母是誰？`
        case 'node-convergence':
            return `節點匯聚確認`
        case 'lateral-inquiry':
            return `「${(props.currentTask as any).targetNodeName}」的婚姻狀況`
        case 'downward-inquiry':
            return `「${(props.currentTask as any).targetNodeName}」的子女`
        default:
            return '答題'
    }
})

const questionSubtitle = computed(() => {
    if (!props.currentTask) return ''

    if (props.currentTask.type === 'attribute-filling') {
        const task = props.currentTask as any
        if (task.attributeType === 'gender') {
            return '請確認性別'
        } else if (task.attributeType === 'birthday') {
            return '請選擇出生日期'
        }
    }

    return ''
})

// 確認答案
const confirmAnswer = async () => {
    if (!canConfirm.value || isLoading.value) return

    isLoading.value = true

    try {
        // 轉換答案格式
        let answer: any = answerInput.value

        if (props.currentTask?.type === 'attribute-filling') {
            const task = props.currentTask as any
            if (task.attributeType === 'gender') {
                answer = answer === 'male' ? 'male' : answer === 'female' ? 'female' : 'unknown'
            }
        }

        if (props.currentTask?.type === 'node-convergence') {
            answer = answerInput.value === 'yes'
        }

        if (props.currentTask?.type === 'lateral-inquiry') {
            // 直接傳 "yes" 或 "no"
            answer = answerInput.value
        }

        if (props.currentTask?.type === 'downward-inquiry') {
            if (answerInput.value === 'no') {
                answer = 'no'
            } else if (answerInput.value === 'no_more') {
                answer = 0 // 沒有額外子女
            } else if (answerInput.value === 'has_children') {
                answer = childrenCountInput.value || 0
            } else if (answerInput.value === 'has_more') {
                answer = { hasMore: true, additionalCount: childrenCountInput.value || 0 }
            }
        }

        emit('answer-submitted', answer)
        answerInput.value = ''
        childrenCountInput.value = null
    } finally {
        isLoading.value = false
    }
}

// 跳過任務
const skipTask = () => {
    if (isLoading.value) return
    emit('task-skipped')
    answerInput.value = ''
    childrenCountInput.value = null
}

// 倒計時計時器
onMounted(() => {
    timerInterval = setInterval(() => {
        remainingTime.value--
        if (remainingTime.value <= 0) {
            if (timerInterval) clearInterval(timerInterval)
            emit('time-expired')
        }
    }, 1000)
})

onBeforeUnmount(() => {
    if (timerInterval) clearInterval(timerInterval)
})
</script>

<style scoped>
/* 額外樣式（如需要） */
</style>
