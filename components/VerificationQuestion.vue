<template>
<div class="min-h-screen bg-[#FAF8F3] flex flex-col p-6">
    <div class="w-full max-w-[390px] mx-auto flex flex-col gap-6 flex-1">
        <!-- 階段標示 -->
        <div class="text-center">
            <div class="inline-block px-3 py-1 bg-[#8B2635]/10 rounded-full text-xs font-bold text-[#8B2635]">
                ✅ 驗證階段
            </div>
        </div>

        <!-- 結果反饋 Toast（短暫顯示上一題結果） -->
        <Transition name="fade">
            <div v-if="showResult" class="p-3 rounded-lg text-center text-sm font-medium" :class="resultClass">
                {{ resultMessage }}
                <span v-if="resultScoreDelta > 0" class="ml-1 font-bold">+{{ resultScoreDelta }} 分</span>
            </div>
        </Transition>

        <!-- 轉發結果通知 -->
        <Transition name="fade">
            <div v-if="showForwardResult" class="p-3 rounded-lg text-center text-sm font-medium bg-[#D4AF37]/20 text-[#5C2E2E] border border-[#D4AF37]/40">
                {{ forwardResultMessage }}
                <span v-if="forwardResultDelta > 0" class="ml-1 font-bold">+{{ forwardResultDelta }} 分</span>
            </div>
        </Transition>

        <!-- 問題卡片 -->
        <div v-if="question" class="bg-white rounded-2xl shadow-md p-6 space-y-5 border border-[#8B8278]/10">
            <!-- 問題類別 tag -->
            <div class="flex items-center gap-2">
                <span class="text-xs px-2 py-0.5 rounded-full" :class="categoryClass">
                    {{ categoryLabel }}
                </span>
                <span v-if="question.isForwarded" class="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                    🔁 轉發驗證
                </span>
            </div>

            <!-- 問題文字 -->
            <h2 class="text-xl font-bold text-[#5C2E2E] leading-relaxed">
                {{ question.questionText }}
            </h2>

            <!-- 答題區域 -->
            <div class="space-y-3">
                <!-- Yes / No -->
                <div v-if="question.answerFormat === 'yes-no'" class="flex gap-3">
                    <button @click="submitAnswer(true)"
                        class="flex-1 py-3 rounded-xl text-lg font-bold transition-all border-2"
                        :class="selectedAnswer === true
                            ? 'bg-[#8B2635] text-white border-[#D4AF37]'
                            : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:bg-[#F5F1E8]'">
                        ⭕️ 是
                    </button>
                    <button @click="submitAnswer(false)"
                        class="flex-1 py-3 rounded-xl text-lg font-bold transition-all border-2"
                        :class="selectedAnswer === false
                            ? 'bg-[#8B2635] text-white border-[#D4AF37]'
                            : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:bg-[#F5F1E8]'">
                        ❌ 不是
                    </button>
                </div>

                <!-- 性別選擇 -->
                <div v-else-if="question.answerFormat === 'gender'" class="flex gap-3">
                    <button @click="submitAnswer('male')"
                        class="flex-1 py-3 rounded-xl text-lg font-bold transition-all border-2"
                        :class="selectedAnswer === 'male'
                            ? 'bg-blue-600 text-white border-blue-400'
                            : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:bg-blue-50'">
                        👨 男性
                    </button>
                    <button @click="submitAnswer('female')"
                        class="flex-1 py-3 rounded-xl text-lg font-bold transition-all border-2"
                        :class="selectedAnswer === 'female'
                            ? 'bg-pink-600 text-white border-pink-400'
                            : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:bg-pink-50'">
                        👩 女性
                    </button>
                </div>

                <!-- 數字輸入 -->
                <div v-else-if="question.answerFormat === 'number'" class="space-y-3">
                    <div class="flex items-center justify-center gap-4">
                        <button @click="numberAnswer = Math.max(0, numberAnswer - 1)"
                            class="w-12 h-12 rounded-full border-2 border-[#8B8278]/20 flex items-center justify-center text-xl font-bold text-[#5C2E2E] hover:bg-[#F5F1E8]">
                            −
                        </button>
                        <span class="text-4xl font-bold text-[#8B2635] min-w-[3rem] text-center">{{ numberAnswer }}</span>
                        <button @click="numberAnswer++"
                            class="w-12 h-12 rounded-full border-2 border-[#8B8278]/20 flex items-center justify-center text-xl font-bold text-[#5C2E2E] hover:bg-[#F5F1E8]">
                            +
                        </button>
                    </div>
                    <button @click="submitAnswer(numberAnswer)"
                        class="w-full py-3 rounded-xl bg-[#8B2635] text-white font-bold text-lg hover:bg-[#6B1D29] transition-all">
                        確認
                    </button>
                </div>

                <!-- 多選 / 文字輸入 -->
                <div v-else-if="question.answerFormat === 'multiple-choice' && question.options?.length" class="space-y-2">
                    <button v-for="opt in question.options" :key="opt" @click="submitAnswer(opt)"
                        class="w-full py-3 px-4 rounded-xl border-2 text-left font-medium transition-all"
                        :class="selectedAnswer === opt
                            ? 'bg-[#8B2635] text-white border-[#D4AF37]'
                            : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:bg-[#F5F1E8]'">
                        {{ opt }}
                    </button>
                </div>

                <!-- 文字輸入 -->
                <div v-else class="space-y-3">
                    <input v-model="textAnswer" type="text" placeholder="請輸入答案..."
                        class="w-full px-4 py-3 rounded-xl border-2 border-[#8B8278]/20 focus:border-[#8B2635] focus:outline-none text-[#5C2E2E]"
                        @keyup.enter="submitAnswer(textAnswer)" />
                    <button @click="submitAnswer(textAnswer)" :disabled="!textAnswer.trim()"
                        class="w-full py-3 rounded-xl bg-[#8B2635] text-white font-bold text-lg hover:bg-[#6B1D29] transition-all disabled:opacity-40">
                        確認
                    </button>
                </div>
            </div>
        </div>

        <!-- 等待狀態 -->
        <div v-if="!question && waiting" class="flex-1 flex items-center justify-center">
            <div class="text-center space-y-4">
                <div class="w-16 h-16 mx-auto bg-[#D4AF37] rounded-full flex items-center justify-center border-4 border-[#8B2635] shadow-lg">
                    <div class="text-2xl">⏳</div>
                </div>
                <h2 class="text-xl font-bold text-[#5C2E2E]">等待其他家人驗證...</h2>
                <p class="text-[#8B8278] text-sm">驗證問題已全部完成或正在分配中</p>
            </div>
        </div>

        <!-- 底部跳過按鈕 -->
        <div v-if="question" class="mt-auto pt-4">
            <button @click="handleSkip"
                class="w-full py-2 text-sm text-[#8B8278] hover:text-[#8B2635] transition-colors">
                不確定，跳過 →
            </button>
        </div>
    </div>
</div>
</template>

<script setup lang="ts">
const props = defineProps<{
    question: {
        questionId: string
        questionText: string
        answerFormat: 'yes-no' | 'number' | 'multiple-choice' | 'gender' | 'text'
        options?: string[]
        category: string
        isForwarded?: boolean
    } | null
    result: {
        questionId: string
        outcome: string
        scoreDelta: number
        message: string
        isForwardResult?: boolean
    } | null
    waiting: boolean
}>()

const emit = defineEmits<{
    (e: 'answer', questionId: string, answer: any): void
    (e: 'skip', questionId: string): void
}>()

const selectedAnswer = ref<any>(null)
const numberAnswer = ref(0)
const textAnswer = ref('')

// 結果顯示邏輯
const showResult = ref(false)
const resultMessage = ref('')
const resultScoreDelta = ref(0)
const resultOutcome = ref('')

const showForwardResult = ref(false)
const forwardResultMessage = ref('')
const forwardResultDelta = ref(0)

// 監聽 result 變化
watch(() => props.result, (newResult) => {
    if (!newResult) return

    if (newResult.isForwardResult) {
        // 轉發結果
        forwardResultMessage.value = newResult.message
        forwardResultDelta.value = newResult.scoreDelta
        showForwardResult.value = true
        setTimeout(() => { showForwardResult.value = false }, 4000)
    } else {
        // 普通驗證結果
        resultMessage.value = newResult.message
        resultScoreDelta.value = newResult.scoreDelta
        resultOutcome.value = newResult.outcome
        showResult.value = true
        setTimeout(() => { showResult.value = false }, 2500)
    }
}, { immediate: true })

// 監聽新題目重置答案
watch(() => props.question, () => {
    selectedAnswer.value = null
    numberAnswer.value = 0
    textAnswer.value = ''
})

const categoryLabel = computed(() => {
    if (!props.question) return ''
    const map: Record<string, string> = {
        'parent-confirm': '👨‍👦 親子關係',
        'spouse-confirm': '💑 配偶關係',
        'children-count': '👶 子女數量',
        'kinship-reverse': '🏷️ 稱謂反查',
        'attribute-verify': '📋 屬性驗證',
        'sibling-verify': '👫 兄弟姐妹',
        'path-relation': '🔗 路徑關係',
    }
    return map[props.question.category] ?? '驗證'
})

const categoryClass = computed(() => {
    if (!props.question) return ''
    const map: Record<string, string> = {
        'parent-confirm': 'bg-red-100 text-red-700',
        'spouse-confirm': 'bg-pink-100 text-pink-700',
        'children-count': 'bg-blue-100 text-blue-700',
        'kinship-reverse': 'bg-purple-100 text-purple-700',
        'attribute-verify': 'bg-green-100 text-green-700',
        'sibling-verify': 'bg-yellow-100 text-yellow-700',
        'path-relation': 'bg-gray-100 text-gray-700',
    }
    return map[props.question.category] ?? 'bg-gray-100 text-gray-700'
})

const resultClass = computed(() => {
    if (resultOutcome.value === 'verified') return 'bg-green-100 text-green-700 border border-green-300'
    if (resultOutcome.value === 'pending_forward') return 'bg-yellow-100 text-yellow-700 border border-yellow-300'
    if (resultOutcome.value === 'tree_corrected') return 'bg-blue-100 text-blue-700 border border-blue-300'
    if (resultOutcome.value === 'player_wrong') return 'bg-red-100 text-red-700 border border-red-300'
    return 'bg-gray-100 text-gray-700 border border-gray-300'
})

function submitAnswer(answer: any) {
    if (!props.question) return
    selectedAnswer.value = answer
    emit('answer', props.question.questionId, answer)
}

function handleSkip() {
    if (!props.question) return
    emit('skip', props.question.questionId)
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
