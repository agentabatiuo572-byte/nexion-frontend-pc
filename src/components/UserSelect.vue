<script setup lang="ts">
import { computed, ref } from 'vue'
import { searchUsers, type UserSearchItem } from '@/apis/auth'
import type { Id } from '@/types/common'
import { localeText } from '@/utils/i18n'

const props = withDefaults(defineProps<{
  modelValue?: Id | ''
  width?: string
  placeholder?: string
}>(), {
  modelValue: '',
  width: '220px',
  placeholder: ''
})

const emit = defineEmits<{
  'update:modelValue': [value: Id | '']
}>()

const options = ref<UserSearchItem[]>([])
const loading = ref(false)
const placeholderText = computed(() => props.placeholder || localeText('输入手机号、昵称或推荐码搜索', 'Search by phone, nickname, or referral code'))

async function remoteSearchUsers(keyword: string) {
  const normalized = keyword.trim()
  if (normalized.length < 2) {
    options.value = []
    return
  }
  loading.value = true
  try {
    options.value = await searchUsers(normalized, { silentError: true })
  } finally {
    loading.value = false
  }
}

function optionLabel(user: UserSearchItem) {
  return `${user.nickname || localeText('未命名用户', 'Unnamed User')} / ${user.phoneMasked || '-'} / ${user.referralCode || '-'}`
}

function updateValue(value: Id | '') {
  emit('update:modelValue', value === '' || value == null ? '' : Number(value))
}
</script>

<template>
  <el-select
    :model-value="props.modelValue"
    filterable
    remote
    clearable
    reserve-keyword
    :remote-method="remoteSearchUsers"
    :loading="loading"
    :placeholder="placeholderText"
    :style="{ width: props.width }"
    @update:model-value="updateValue"
  >
    <el-option
      v-for="item in options"
      :key="item.userId"
      :label="optionLabel(item)"
      :value="Number(item.userId)"
    >
      <div class="user-select-option">
        <strong>{{ item.nickname || localeText('未命名用户', 'Unnamed User') }}</strong>
        <span>{{ item.phoneMasked }} · {{ item.referralCode }} · {{ item.userLevel }}/{{ item.vRank }}</span>
      </div>
    </el-option>
  </el-select>
</template>

<style scoped>
.user-select-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.25;
}

.user-select-option span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
