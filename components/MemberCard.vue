<template>
  <div class="member-card">
    <div class="avatar">{{ data.avatar || '👤' }}</div>
    <div class="info">
      <div class="name">{{ data.label }}</div>
      <div class="meta" v-if="data.relation">{{ data.relation }}</div>
    </div>
    <Handle type="target" :position="Position.Top" />
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import type { NodeProps } from '@vue-flow/core'

interface MemberData {
  label: string
  relation?: string
  avatar?: string
}

defineProps<NodeProps<MemberData>>()
</script>

<style scoped>
.member-card {
  padding: 10px;
  background: white;
  border: 2px solid #333;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 120px;
}

.avatar {
  font-size: 24px;
}

.info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.name { 
  font-weight: bold;
  font-size: 14px;
}

.meta { 
  font-size: 12px;
  color: #666;
}
</style>
