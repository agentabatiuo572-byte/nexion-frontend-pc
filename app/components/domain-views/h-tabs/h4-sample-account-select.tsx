"use client";

import { useState } from 'react';
import { promotionRead } from '@/lib/admin/promotion-client';
import type { AccountSamplePage } from '@/lib/admin/promotion-types';
import { Button, Field, Notice, ReadError, useRead } from './h4-promotion-ui';

/** The server supplies the simulation identity; user codes are never converted into IDs. */
export function H4SampleAccountSelect({ value, onChange, allowed, disabled }: {
    value: string;
    onChange: (accountId: string) => void;
    allowed: boolean;
    disabled: boolean;
}) {
    const [mode, setMode] = useState<'keyword' | 'accountId'>('keyword'), [text, setText] = useState(''), [selectedLabel, setSelectedLabel] = useState('');
    const [query, setQuery] = useState<Record<string, string | number> | null>(null);
    const [inputError, setInputError] = useState<unknown>(null);
    const accounts = useRead(() => promotionRead<AccountSamplePage>('/promotion-account-samples', query!), [JSON.stringify(query)], allowed && query !== null);
    const search = () => {
        if (!allowed || disabled) return;
        setInputError(null);
        const keyword = text.trim(), digits = keyword.replace(/\D/g, '');
        if (mode === 'keyword' && /^[+0-9()\s-]+$/.test(keyword) && digits.length >= 10 && digits.length <= 15) {
            setInputError(new Error('C1_RAW_PHONE_SEARCH_FORBIDDEN')); return;
        }
        setQuery({ [mode]: keyword, pageNum: 1 }); accounts.reload();
    };
    const page = accounts.data, changing = disabled || accounts.loading || !allowed;
    return <fieldset className="form-section" disabled={disabled || !allowed}>
        <legend>选择授权账户样本（可选）</legend>
        <div className="grid2"><Field label="查找方式"><select value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="keyword">用户编码 / 昵称</option><option value="accountId">账户 ID（精确）</option></select></Field><Field label={mode === 'keyword' ? '用户编码 / 昵称' : '账户 ID'} hint={mode === 'keyword' ? '沿用 C1 的授权范围和隐私限制，不支持明文手机号。' : '填写已知账户 ID；用户编码请使用另一查找方式。'}><input value={text} maxLength={200} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); search(); } }}/></Field></div>
        <Button onClick={search} disabled={changing}>{accounts.loading ? '正在查找…' : '查找账户'}</Button>
        {!!inputError && <ReadError target="账户搜索条件" error={inputError} retry={search}/>}
        {!!accounts.error && <ReadError target="授权账户搜索" error={accounts.error} retry={accounts.reload}/>}
        {!query && <p className="help">输入用户编码或昵称查找，也可留空后逐页选择。选中的账户仍须经过活动资格试算。</p>}
        {page && <><Field label="样本账户"><select value={value} disabled={changing || !!accounts.error} onChange={event => { const id = event.target.value; setSelectedLabel(page.items.find(item => item.accountId === id)?.label || ''); onChange(id); }}><option value="">不选择，资格标未知</option>{value && !page.items.some(item => item.accountId === value) && <option value={value}>{selectedLabel || '已选择账户'} · 当前所选</option>}{page.items.map(item => <option value={item.accountId} key={item.accountId}>{item.label}</option>)}</select></Field>
            {accounts.loading && <Notice title="正在刷新搜索结果">保留原选择，读取完成后可选择新账户。</Notice>}
            {!!accounts.error && <Notice title="搜索结果尚未更新" kind="warn">保留上次结果和原选择，请重试；试算时将重新检查账户访问权限。</Notice>}
            {!page.items.length && !accounts.loading && !accounts.error && <p className="help">没有符合条件的可读账户，可调整搜索内容后重试。</p>}
            <div className="actions"><span>共 {page.total} 个可读账户 · 第 {page.pageNum} 页</span><Button disabled={changing || !!accounts.error || page.pageNum <= 1} onClick={() => setQuery({ ...query!, pageNum: page.pageNum - 1 })}>上一页</Button><Button disabled={changing || !!accounts.error || page.pageNum * page.pageSize >= page.total} onClick={() => setQuery({ ...query!, pageNum: page.pageNum + 1 })}>下一页</Button></div>
        </>}
        {value && <Button kind="link" onClick={() => { onChange(''); setSelectedLabel(''); }}>取消账户选择，资格标未知</Button>}
    </fieldset>;
}
