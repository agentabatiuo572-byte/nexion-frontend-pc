"use client";
import { useEffect, useState } from 'react';
import { refreshAdminMediaPreviewUrl } from '@/lib/admin/media-client';
import { BusinessFormBlock } from '../design-kit';
import { Button, ReadError, useRead } from './h4-promotion-ui';

export function PromotionBannerPreview({ assetId }: { assetId: string | null | undefined }) {
    const preview = useRead(() => assetId ? refreshAdminMediaPreviewUrl(assetId) : Promise.resolve(null), [assetId]);
    const [imageFailed, setImageFailed] = useState(false);
    useEffect(() => { setImageFailed(false); }, [assetId]);
    const src = preview.data?.assetId === assetId ? preview.data?.previewUrl : null;
    const retry = () => { setImageFailed(false); preview.reload(); };
    return assetId ? preview.loading ? <p role="status">正在加载宣传图…</p> : preview.error || imageFailed ? <ReadError target="活动宣传图" error={preview.error || new Error('图片暂时无法显示，请重试。')} retry={retry}/> : src ? <img key={assetId} src={src} alt="当前活动宣传图" onError={() => setImageFailed(true)} style={{ display: 'block', maxWidth: '100%', maxHeight: 220, objectFit: 'contain', marginTop: 12 }}/> : <Button onClick={retry}>读取宣传图</Button> : null;
}

export function PromotionBanner({ assetId, readOnly, onChange, onUploading }: {
    assetId: string | null | undefined;
    readOnly: boolean;
    onChange: (assetId: string | null) => void;
    onUploading: (uploading: boolean) => void;
}) {
    return <div className="form-section">
        <fieldset disabled={readOnly}><BusinessFormBlock spec={{ kind: 'multi-field', title: '活动宣传图', fields: [{ key: 'bannerAssetId', label: assetId ? '替换宣传图' : '上传宣传图', inputKind: 'asset-upload', required: false, wide: true, uploadDomain: 'growth', uploadUsage: 'promotion-banner', accept: 'image/jpeg,image/png', help: 'JPEG 或 PNG，最大 10 MB。未设置图片时仅展示活动文字。' }] }} value={{ bannerAssetId: assetId || '' }} onChange={value => { if (!readOnly) onChange(value.bannerAssetId || null); }} onUploadStateChange={(_, state) => onUploading(state === 'uploading')}/></fieldset>
        <PromotionBannerPreview assetId={assetId}/>
    </div>;
}
