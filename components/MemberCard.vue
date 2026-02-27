<template>
<div class="member-card" :class="[cardClass, { 'card-highlighted': isHighlighted }]">
  <!-- 高亮動畫（新更新的節點） -->
  <div v-if="isHighlighted" class="highlight-ring-outer"></div>

  <!-- 上下 Handle（親子關係） -->
  <Handle id="top" type="target" :position="Position.Top" class="handle-dot" />
  <Handle id="bottom" type="source" :position="Position.Bottom" class="handle-dot" />
  <!-- 左右 Handle（配偶關係） -->
  <Handle id="left" type="target" :position="Position.Left" class="handle-dot handle-side" />
  <Handle id="right" type="source" :position="Position.Right" class="handle-dot handle-side" />

  <div class="avatar">{{ data.avatar || '👤' }}</div>
  <div class="info">
    <div class="name-row">
      <span class="name" :class="nameClass">{{ data.label }}</span>
      <span class="age-badge" :class="ageBadgeClass">{{ ageDisplay }}</span>
    </div>
    <div class="meta" v-if="data.relation">{{ data.relation }}</div>
    <div v-if="data.isVirtual && !data.isConfirmed" class="virtual-badge">待填充</div>
  </div>
</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import type { NodeProps } from '@vue-flow/core'

interface MemberData {
  label: string
  relation?: string
  avatar?: string
  isVirtual?: boolean
  isPlayer?: boolean
  isConfirmed?: boolean
  gender?: 'male' | 'female' | 'unknown'
  isHighlighted?: boolean
  birthday?: string  // ISO date string (YYYY-MM-DD)
}

const props = defineProps<NodeProps<MemberData>>()

const cardClass = computed(() => {
  // 虛擬節點但已確認資料 → 顯示與玩家節點相同的樣式
  if (props.data.isVirtual && !props.data.isConfirmed) return 'card-virtual'
  if (props.data.gender === 'male') return 'card-male'
  if (props.data.gender === 'female') return 'card-female'
  return 'card-unknown'
})

const nameClass = computed(() => {
  if (props.data.isVirtual && !props.data.isConfirmed) return 'text-[#8B8278]'
  return 'text-white'
})

const isHighlighted = computed(() => props.data.isHighlighted ?? false)

/** 根據生日計算年齡，無生日則顯示 ? */
const ageDisplay = computed(() => {
  if (!props.data.birthday) return '?歲'
  const birth = new Date(props.data.birthday)
  if (isNaN(birth.getTime())) return '?歲'
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return `${age}歲`
})

const ageBadgeClass = computed(() => {
  if (props.data.isVirtual && !props.data.isConfirmed) return 'age-badge-virtual'
  return 'age-badge-filled'
})
</script>

<style scoped>
.member-card {
  padding: 8px 12px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 140px;
  max-width: 180px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  transition: box-shadow 0.2s;
  position: relative;
}

.member-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.card-female {
  background: #8B2635;
  border: 2px solid #D4AF37;
}

.card-male {
  background: #4A7C9E;
  border: 2px solid #D4AF37;
}

.card-unknown {
  background: #6B5B4E;
  border: 2px solid #D4AF37;
}

.card-virtual {
  background: #FAF8F3;
  border: 2px dashed #8B8278;
}

.card-highlighted {
  box-shadow: 0 0 16px rgba(212, 175, 55, 0.6);
}

.highlight-ring-outer {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 100%;
  height: 100%;
  border: 2px solid #D4AF37;
  border-radius: 10px;
  transform: translate(-50%, -50%);
  animation: pingHighlight 1.5s ease-out forwards;
}

@keyframes pingHighlight {
  0% {
    box-shadow: 0 0 0 0 rgba(212, 175, 55, 0.8);
    opacity: 1;
  }

  100% {
    box-shadow: 0 0 0 16px rgba(212, 175, 55, 0);
    opacity: 0;
  }
}

.avatar {
  font-size: 22px;
  line-height: 1;
}

.info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.name {
  font-weight: 700;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.age-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 0 4px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

.age-badge-filled {
  background: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.9);
}

.age-badge-virtual {
  background: rgba(139, 130, 120, 0.15);
  color: #8B8278;
}

.meta {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.75);
}

.card-virtual .meta {
  color: #8B8278;
}

.virtual-badge {
  font-size: 10px;
  color: #D4AF37;
  font-weight: 600;
}

/* Handle 樣式 */
.handle-dot {
  width: 8px !important;
  height: 8px !important;
  background: #D4AF37 !important;
  border: 2px solid #FAF8F3 !important;
}

.handle-side {
  opacity: 0.5;
}

.member-card:hover .handle-side {
  opacity: 1;
}
</style>
