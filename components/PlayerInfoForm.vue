<template>
<div class="min-h-screen bg-[#FAF8F3] flex flex-col items-center justify-center p-6">
  <div class="w-full max-w-[390px] flex flex-col items-center gap-6 relative z-10">
    <!-- Logo -->
    <div
      class="w-20 h-20 bg-[#8B2635] rounded-full flex items-center justify-center border-4 border-[#D4AF37] shadow-lg">
      <div class="text-3xl text-[#FAF8F3]">族</div>
    </div>

    <!-- 標題 -->
    <div class="text-center space-y-2">
      <h2 class="text-2xl font-bold text-[#5C2E2E]">輸入你的基本資料</h2>
      <p class="text-[#8B8278] text-sm">這些資料將用於遊戲中定位你的位置</p>
      <p v-if="isPreFilled" class="text-xs text-[#D4AF37] font-medium">✦ 已帶入上次填寫的資料，可直接修改</p>
    </div>

    <!-- 表單 -->
    <form @submit.prevent="handleSubmit" class="w-full space-y-5">
      <!-- 姓名 -->
      <div class="space-y-2">
        <label class="block text-[#5C2E2E] font-medium">
          真實姓名 <span class="text-red-500">*</span>
        </label>
        <input v-model="formData.name" type="text" placeholder="請輸入你的姓名"
          class="w-full py-3 px-4 rounded-md border-2 border-[#8B8278]/30 bg-[#F5F1E8] text-[#5C2E2E] placeholder:text-[#8B8278]/50 focus:outline-none focus:border-[#8B2635] transition-colors"
          maxlength="10" @input="notifyTyping" />
        <p class="text-xs text-[#8B8278]">2-10 個字元</p>
      </div>

      <!-- 性別 -->
      <div class="space-y-2">
        <label class="block text-[#5C2E2E] font-medium">
          性別 <span class="text-red-500">*</span>
        </label>
        <div class="grid grid-cols-2 gap-3">
          <button type="button" @click="formData.gender = 'male'"
            class="py-3 rounded-md border-2 transition-all font-medium flex items-center justify-center gap-2" :class="formData.gender === 'male'
                ? 'bg-[#8B2635] text-[#FAF8F3] border-[#D4AF37]'
                : 'bg-[#F5F1E8] text-[#8B2635] border-[#8B8278]/30 hover:border-[#8B2635]'
              ">
            <span class="text-xl">👨</span>
            <span>男性</span>
          </button>
          <button type="button" @click="formData.gender = 'female'"
            class="py-3 rounded-md border-2 transition-all font-medium flex items-center justify-center gap-2" :class="formData.gender === 'female'
                ? 'bg-[#8B2635] text-[#FAF8F3] border-[#D4AF37]'
                : 'bg-[#F5F1E8] text-[#8B2635] border-[#8B8278]/30 hover:border-[#8B2635]'
              ">
            <span class="text-xl">👩</span>
            <span>女性</span>
          </button>
        </div>
      </div>

      <!-- 出生日期 -->
      <div class="space-y-2">
        <label class="block text-[#5C2E2E] font-medium">
          完整出生日期 <span class="text-red-500">*</span>
        </label>
        <input v-model="formData.birthday" type="date"
          class="w-full py-3 px-4 rounded-md border-2 border-[#8B8278]/30 bg-[#F5F1E8] text-[#5C2E2E] focus:outline-none focus:border-[#8B2635] transition-colors"
          :max="maxDate" />
        <p class="text-xs text-[#8B8278]">此日期用於系統定位，請務必填寫正確</p>
      </div>

      <!-- 錯誤提示 -->
      <div v-if="error" class="p-3 bg-red-100 border border-red-300 rounded-md text-red-700 text-sm">
        {{ error }}
      </div>

      <!-- 提交按鈕 -->
      <button type="submit" :disabled="!isValid || isSubmitting"
        class="w-full py-4 rounded-md border-2 font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        :class="isValid && !isSubmitting
            ? 'bg-transparent text-[#8B2635] border-[#8B2635] hover:bg-[#8B2635] hover:text-[#FAF8F3]'
            : 'bg-[#F5F1E8] text-[#8B8278] border-[#8B8278]/30'
          ">
        {{ isSubmitting ? '加入中...' : '加入遊戲' }}
      </button>
    </form>
  </div>
</div>
</template>

<script setup lang="ts">
const props = defineProps<{
  roomId: string
}>()

const emit = defineEmits<{
  submit: [data: { name: string; gender: 'male' | 'female'; birthday: string }]
  typing: []
}>()

const PROFILE_KEY = 'playerProfile'

const formData = ref({
  name: '',
  gender: '' as 'male' | 'female' | '',
  birthday: '',
})

const error = ref<string | null>(null)
const isSubmitting = ref(false)
const isPreFilled = ref(false)

// 掛載時讀取上次填過的個人資料
onMounted(() => {
  try {
    const saved = localStorage.getItem(PROFILE_KEY)
    if (saved) {
      const profile = JSON.parse(saved)
      formData.value.name = profile.name ?? ''
      formData.value.gender = profile.gender ?? ''
      formData.value.birthday = profile.birthday ?? ''
      isPreFilled.value = !!(profile.name || profile.gender || profile.birthday)
    }
  } catch {
    // localStorage 不可用或資料損壞，忽略
  }
})

// 最大日期（今天）
const maxDate = computed(() => {
  const today = new Date()
  return today.toISOString().split('T')[0]
})

// 驗證表單
const isValid = computed(() => {
  return (
    formData.value.name.length >= 2 &&
    formData.value.name.length <= 10 &&
    formData.value.gender &&
    formData.value.birthday &&
    isValidDate(formData.value.birthday)
  )
})

// 驗證日期
const isValidDate = (dateString: string): boolean => {
  if (!dateString) return false
  const date = new Date(dateString)
  return !isNaN(date.getTime()) && date <= new Date()
}

// 通知正在輸入
let typingTimeout: NodeJS.Timeout | null = null
const notifyTyping = () => {
  if (typingTimeout) clearTimeout(typingTimeout)

  typingTimeout = setTimeout(() => {
    emit('typing')
  }, 500)
}

// 提交表單
const handleSubmit = () => {
  if (!isValid.value || isSubmitting.value) return

  // 驗證
  if (formData.value.name.length < 2 || formData.value.name.length > 10) {
    error.value = '姓名長度需為 2-10 字元'
    return
  }

  if (!formData.value.gender) {
    error.value = '請選擇性別'
    return
  }

  if (!isValidDate(formData.value.birthday)) {
    error.value = '請輸入有效的出生日期'
    return
  }

  error.value = null
  isSubmitting.value = true

  // 儲存個人資料供下次預填（與 roomId / playerId 無關）
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({
      name: formData.value.name,
      gender: formData.value.gender,
      birthday: formData.value.birthday,
    }))
  } catch {
    // 儲存失敗不影響遊戲流程
  }

  emit('submit', {
    name: formData.value.name,
    gender: formData.value.gender,
    birthday: formData.value.birthday,
  })

  // 5 秒後重置
  setTimeout(() => {
    isSubmitting.value = false
  }, 5000)
}
</script>
