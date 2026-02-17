<template>
  <div class="min-h-screen bg-[#FAF8F3] flex flex-col p-6">
    <div class="w-full max-w-[390px] mx-auto flex flex-col gap-6 flex-1">
      <!-- 倒计时进度条 -->
      <div class="space-y-2">
        <div class="flex justify-between items-center text-sm">
          <span class="text-[#8B8278]">剩餘時間</span>
          <span class="font-bold text-[#8B2635]">{{ remainingTime }}秒</span>
        </div>
        <div class="h-2 bg-[#F5F1E8] rounded-full overflow-hidden">
          <div 
            class="h-full bg-gradient-to-r from-[#8B2635] to-[#D4AF37] transition-all duration-1000"
            :style="{ width: `${progressPercentage}%` }"
          ></div>
        </div>
      </div>

      <!-- 问题标题 -->
      <div class="text-center space-y-3">
        <h2 class="text-2xl font-bold text-[#5C2E2E]">
          {{ currentQuestion?.targetPlayerName }} {{ questionTitle }}
        </h2>
      </div>

      <!-- 第一阶段：选择方向 -->
      <div v-if="currentStage === 1" class="flex-1 space-y-3">
        <button
          v-for="direction in directionOptions"
          :key="direction.value"
          @click="selectDirection(direction.value)"
          class="w-full py-4 px-6 rounded-lg border-2 transition-all text-left font-medium"
          :class="
            selectedDirection === direction.value
              ? 'bg-[#8B2635] text-[#FAF8F3] border-[#D4AF37] shadow-lg'
              : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:border-[#8B2635]/40 hover:bg-[#F5F1E8]'
          "
        >
          <div class="flex items-center gap-3">
            <span class="text-2xl">{{ direction.icon }}</span>
            <span>{{ direction.label }}</span>
          </div>
        </button>
      </div>

      <!-- 第二阶段：选择具体称谓 -->
      <div v-else-if="currentStage === 2" class="flex-1 space-y-3">
        <button
          v-for="relation in filteredRelations"
          :key="relation"
          @click="selectRelation(relation)"
          class="w-full py-4 px-6 rounded-lg border-2 transition-all text-left font-medium"
          :class="
            selectedRelation === relation
              ? 'bg-[#8B2635] text-[#FAF8F3] border-[#D4AF37] shadow-lg'
              : 'bg-white text-[#5C2E2E] border-[#8B8278]/20 hover:border-[#8B2635]/40 hover:bg-[#F5F1E8]'
          "
        >
          {{ relation }}
        </button>
      </div>

      <!-- 底部按钮 -->
      <div class="space-y-3 mt-auto">
        <button
          @click="skipQuestion"
          class="w-full py-3 text-[#8B8278] hover:text-[#5C2E2E] transition-colors font-medium"
        >
          跳過此題
        </button>
        <button
          @click="confirmAnswer"
          :disabled="!canConfirm"
          class="w-full py-4 rounded-lg font-bold text-lg transition-all shadow-md"
          :class="
            canConfirm
              ? 'bg-[#8B2635] text-white hover:bg-[#5C2E2E] active:scale-95'
              : 'bg-[#8B8278]/30 text-[#8B8278] cursor-not-allowed'
          "
        >
          確認
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Question {
  questionId: string
  askedPlayerId: string
  targetPlayerId: string
  targetPlayerName: string
  askedPlayerGender: 'male' | 'female'
}

interface Props {
  currentQuestion: Question | null
  timeLimit?: number
}

interface Emits {
  (e: 'answer', payload: { direction?: string; relation: string }): void
  (e: 'skip'): void
  (e: 'timeout'): void
}

const props = withDefaults(defineProps<Props>(), {
  timeLimit: 120
})

const emit = defineEmits<Emits>()

// 状态
const currentStage = ref<1 | 2>(1)
const selectedDirection = ref<string | null>(null)
const selectedRelation = ref<string | null>(null)
const remainingTime = ref(props.timeLimit)
const timerInterval = ref<NodeJS.Timeout | null>(null)

// 方向选项
const directionOptions = [
  { value: 'father', label: '爸爸那邊的人', icon: '👨' },
  { value: 'mother', label: '媽媽那邊的人', icon: '👩' },
  { value: 'spouse', label: '配偶那邊的人', icon: '💑' },
  { value: 'children', label: '子女那邊的人', icon: '👶' },
  { value: 'unknown', label: '完全不知道', icon: '❓' }
]

// 关系选项（根据方向和性别过滤）
const relationsByDirection = {
  father: {
    male: ['爸爸', '爺爺', '曾祖父', '伯父', '叔叔', '哥哥', '弟弟', '堂兄弟', '堂侄子', '表兄弟'],
    female: ['姑姑', '姊姊', '妹妹', '堂姐妹', '堂甥女', '表姐妹'],
    common: []
  },
  mother: {
    male: ['舅舅', '哥哥', '弟弟', '堂兄弟', '表兄弟', '表侄子'],
    female: ['媽媽', '奶奶', '曾祖母', '阿姨', '姊姊', '妹妹', '堂姐妹', '表姐妹', '表甥女'],
    common: []
  },
  spouse: {
    male: ['丈夫'],
    female: ['妻子'],
    common: ['配偶']
  },
  children: {
    male: ['兒子', '孫子', '曾孫子'],
    female: ['女兒', '孫女', '曾孫女'],
    common: []
  }
}

// 计算属性
const questionTitle = computed(() => {
  if (currentStage.value === 1) {
    return '是在你的：'
  } else {
    const direction = directionOptions.find(d => d.value === selectedDirection.value)
    return `具體是你的誰？（${direction?.label}）`
  }
})

const progressPercentage = computed(() => {
  return (remainingTime.value / props.timeLimit) * 100
})

const canConfirm = computed(() => {
  if (currentStage.value === 1) {
    return selectedDirection.value !== null
  } else {
    return selectedRelation.value !== null
  }
})

const filteredRelations = computed(() => {
  if (!selectedDirection.value || !props.currentQuestion) return []
  
  const direction = selectedDirection.value as keyof typeof relationsByDirection
  const relations = relationsByDirection[direction]
  
  if (!relations) return []
  
  const gender = props.currentQuestion.targetPlayerGender
  const maleRelations = relations.male || []
  const femaleRelations = relations.female || []
  const commonRelations = relations.common || []
  
  // 根據目標玩家（被問的人）的性別過濾選項
  if (gender === 'male') {
    return [...maleRelations, ...commonRelations]
  } else {
    return [...femaleRelations, ...commonRelations]
  }
})

// 方法
const selectDirection = (direction: string) => {
  selectedDirection.value = direction
  
  if (direction === 'unknown') {
    // 如果选择"完全不知道"，直接可以确认
    currentStage.value = 1
  } else {
    // 否则进入第二阶段
    currentStage.value = 2
    selectedRelation.value = null
  }
}

const selectRelation = (relation: string) => {
  selectedRelation.value = relation
}

const confirmAnswer = () => {
  if (!canConfirm.value) return
  
  stopTimer()
  
  if (selectedDirection.value === 'unknown') {
    emit('answer', { relation: '完全不知道' })
  } else if (selectedRelation.value) {
    emit('answer', {
      direction: selectedDirection.value || undefined,
      relation: selectedRelation.value
    })
  }
  
  resetState()
}

const skipQuestion = () => {
  stopTimer()
  emit('skip')
  resetState()
}

const startTimer = () => {
  remainingTime.value = props.timeLimit
  
  timerInterval.value = setInterval(() => {
    remainingTime.value--
    
    if (remainingTime.value <= 0) {
      stopTimer()
      emit('timeout')
      resetState()
    }
  }, 1000)
}

const stopTimer = () => {
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
    timerInterval.value = null
  }
}

const resetState = () => {
  currentStage.value = 1
  selectedDirection.value = null
  selectedRelation.value = null
}

// 监听问题变化
watch(() => props.currentQuestion, (newQuestion) => {
  if (newQuestion) {
    resetState()
    startTimer()
  } else {
    stopTimer()
  }
}, { immediate: true })

// 清理
onUnmounted(() => {
  stopTimer()
})
</script>
