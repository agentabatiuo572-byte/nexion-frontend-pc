<script setup lang="ts">
import { localeText as lt } from '@/utils/i18n'
import { onMounted, reactive, watch } from 'vue'
import { ElMessage, type UploadRequestOptions } from 'element-plus'
import { getProductMediaPreviewUrl, uploadProductMedia, type ProductMediaType } from '@/apis/operation'

const props = withDefaults(defineProps<{
  modelValue?: string
  mediaType?: ProductMediaType
  emptyTitle?: string
  emptyDescription?: string
}>(), {
  modelValue: '',
  mediaType: 'COVER',
  emptyTitle: '',
  emptyDescription: ''
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

const previewUrls = reactive<Record<string, string>>({})

function imageName(objectKey: string) {
  return objectKey.split('/').pop() || objectKey
}

async function loadPreview(objectKey: string) {
  if (!objectKey || previewUrls[objectKey]) return
  try {
    const response = await getProductMediaPreviewUrl(objectKey)
    if (response.downloadUrl) {
      previewUrls[objectKey] = response.downloadUrl
    }
  } catch {
    // 预览失败不阻断表单编辑和保存。
  }
}

function clearImage() {
  if (props.modelValue) {
    delete previewUrls[props.modelValue]
  }
  emit('update:modelValue', '')
}

async function uploadImage(options: UploadRequestOptions) {
  try {
    const response = await uploadProductMedia(props.mediaType, options.file)
    if (response.downloadUrl) {
      previewUrls[response.objectKey] = response.downloadUrl
    }
    emit('update:modelValue', response.objectKey)
    ElMessage.success(lt('图片已上传', 'Image uploaded'))
    options.onSuccess?.(response)
  } catch (error) {
    options.onError?.(error as never)
  }
}

async function openImage() {
  if (!props.modelValue) return
  await loadPreview(props.modelValue)
  const url = previewUrls[props.modelValue]
  if (url) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

watch(() => props.modelValue, (value) => {
  if (value) {
    void loadPreview(value)
  }
})

onMounted(() => {
  if (props.modelValue) {
    void loadPreview(props.modelValue)
  }
})
</script>

<template>
  <el-upload
    class="object-image-upload"
    accept="image/png,image/jpeg,image/webp"
    drag
    :limit="1"
    :show-file-list="false"
    :http-request="uploadImage"
  >
    <div class="image-upload-card" :class="{ 'has-image': !!modelValue }">
      <template v-if="modelValue && previewUrls[modelValue]">
        <img class="image-upload-preview" :src="previewUrls[modelValue]" :alt="imageName(modelValue)" @click.stop="openImage" />
        <el-button class="image-remove-button" circle plain type="danger" @click.stop="clearImage">×</el-button>
      </template>
      <template v-else>
        <el-icon class="image-upload-icon"><Plus /></el-icon>
        <div class="image-upload-title">{{ modelValue ? lt('替换图片', 'Replace Image') : (emptyTitle || lt('上传图片', 'Upload Image')) }}</div>
        <div class="image-upload-desc">{{ modelValue ? lt('点击或拖拽重新上传', 'Click or drag to upload again') : (emptyDescription || lt('拖拽或点击上传图片，支持 PNG/JPG/WebP，最大 5MB', 'Drag or click to upload PNG/JPG/WebP, max 5MB')) }}</div>
      </template>
    </div>
  </el-upload>
</template>

<style scoped>
.object-image-upload {
  display: block;
  width: min(100%, 360px);
}

.image-upload-card {
  display: flex;
  min-height: 188px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  text-align: center;
}

.image-upload-card.has-image {
  position: relative;
  overflow: hidden;
  padding: 0;
  background: var(--el-fill-color-light);
}

.image-upload-preview {
  display: block;
  width: 100%;
  height: 188px;
  cursor: zoom-in;
  object-fit: cover;
}

.image-remove-button {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  border-color: rgb(255 255 255 / 78%);
  background: rgb(0 0 0 / 52%);
  color: #fff;
  font-size: 18px;
  line-height: 20px;
}

.image-upload-icon {
  margin-bottom: 8px;
  color: var(--el-color-primary);
  font-size: 28px;
}

.image-upload-title {
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
}

.image-upload-desc {
  max-width: 220px;
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 18px;
}

:deep(.el-upload),
:deep(.el-upload-dragger) {
  width: 100%;
}

:deep(.el-upload-dragger) {
  padding: 0;
  border-radius: 6px;
}
</style>
