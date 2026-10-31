// 用量 section of the settings sheet: this month's paid speech characters (Google tiers against their free allowance,
// Azure) and Claude requests / tokens / estimated cost, with a step back to earlier months. Mounted when the sheet opens,
// so it fetches GET /api/usage then (game/usageView.ts).
import { useCallback, useEffect, useState } from 'react';
import { cloudStatus } from '../game/cloudTts';
import { IconChevronLeft, IconChevronRight } from './icons';
import {
  GOOGLE_TIER_LABEL, barPct, claudeTotalUsd, clearTtsCache, fallbackTarget, fetchUsage, fmtInt, fmtMonth, fmtPct, fmtTwd, fmtUsd, monthList, monthOf, pastFallbackAt,
  ttsCacheLine, type ClaudeCounter, type TtsCounter, type UsageData, type UsageResult,
} from '../game/usageView';

const AZURE_LABEL = 'Azure 神經語音';

function FreeTierRow({ label, c, free }: { label: string; c: TtsCounter | undefined; free: number | undefined }) {
  const chars = c?.chars ?? 0;
  const counts = `請求 ${c?.requests ?? 0} 次 · 失敗 ${c?.failures ?? 0} · 快取命中 ${c?.cacheHits ?? 0}${c?.fallbacks ? ` · 改用其他 ${c.fallbacks} 次` : ''}`;
  if (free === undefined) {
    return (
      <div className="usage-row">
        <div className="usage-line"><span>{label}</span><b>{fmtInt(chars)} 字</b></div>
        <small className="usage-sub">{counts}</small>
      </div>
    );
  }
  return (
    <div className="usage-row">
      <div className="usage-line">
        <span>{label}</span>
        <b>{fmtInt(chars)} / {fmtInt(free)} 字（{fmtPct(chars, free) || '0%'}）</b>
      </div>
      <div className="usage-bar" role="progressbar" aria-label={`${label} 免費額度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(barPct(chars, free))}>
        <i style={{ width: `${barPct(chars, free)}%` }} />
      </div>
      <small className="usage-sub">{counts}</small>
    </div>
  );
}

function ClaudeRow({ model, c }: { model: string; c: ClaudeCounter }) {
  return (
    <div className="usage-row">
      <div className="usage-line"><span>{model}</span><b>{fmtInt(c.requests)} 次請求</b></div>
      <small className="usage-sub">
        輸入 {fmtInt(c.inputTokens)} · 快取讀取 {fmtInt(c.cacheReadTokens)} · 快取寫入 {fmtInt(c.cacheWriteTokens)} · 輸出 {fmtInt(c.outputTokens)} tokens
        {c.errors ? ` · 失敗 ${c.errors} 次` : ''}
      </small>
      <small className="usage-sub">
        估算費用 {fmtUsd(c.costUsd)}（估算 {fmtTwd(c.costUsd)}）{c.unpriced ? ` · 另有 ${c.unpriced} 次沒有價格，未計入` : ''}
      </small>
    </div>
  );
}

function MonthBody({ data, month }: { data: UsageData; month: string }) {
  const m = monthOf(data, month);
  const free = data.freeTier;
  const googleTiers = Object.keys(free.google);
  const azureOn = !!cloudStatus()?.azure;
  // a tier past 90% says where its speech goes now (the server's planTts uses the same order)
  const warn = googleTiers.filter((t) => pastFallbackAt(data, month, 'google', t));
  const extraGoogle = Object.keys(m.tts.google).filter((t) => !googleTiers.includes(t));
  const claudeModels = Object.keys(m.claude);
  const total = claudeTotalUsd(m);
  return (
    <>
      <h4 className="usage-h">Google 語音（字數，按層級計）</h4>
      {googleTiers.map((t) => (
        <FreeTierRow key={t} label={GOOGLE_TIER_LABEL[t] ?? t} c={m.tts.google[t]} free={free.google[t]} />
      ))}
      {extraGoogle.map((t) => (
        <FreeTierRow key={t} label={t} c={m.tts.google[t]} free={undefined} />
      ))}
      {warn.map((t) => (
        <small key={t} className="usage-warn">{GOOGLE_TIER_LABEL[t] ?? t} 已達 90%，本月改用 {fallbackTarget(data, month, t, azureOn)}</small>
      ))}
      <h4 className="usage-h">Azure 語音</h4>
      <FreeTierRow label={AZURE_LABEL} c={m.tts.azure.neural} free={free.azure.neural} />
      <h4 className="usage-h">Claude</h4>
      {claudeModels.length === 0 ? (
        <small className="usage-sub">這個月還沒有 Claude 請求</small>
      ) : (
        <>
          {claudeModels.map((k) => <ClaudeRow key={k} model={k} c={m.claude[k]} />)}
          {claudeModels.length > 1 && <small className="usage-sub">合計估算 {fmtUsd(total)}（估算 {fmtTwd(total)}）</small>}
        </>
      )}
    </>
  );
}

export function UsagePanel() {
  const [res, setRes] = useState<UsageResult | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // null = this month
  const load = useCallback(() => {
    setRes(null);
    void fetchUsage().then(setRes);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!res) return <div className="usage-panel"><small className="usage-sub">讀取中…</small></div>;
  if (res.kind === 'missing') {
    return <div className="usage-panel"><small className="usage-sub">伺服器重開後才會開始統計</small></div>;
  }
  if (res.kind === 'error') {
    return (
      <div className="usage-panel">
        <small className="usage-sub">讀不到用量，稍後再試</small>
        <button className="as-small" onClick={load}>重試</button>
      </div>
    );
  }

  const data = res.data;
  const months = monthList(data);
  const selected = picked && months.includes(picked) ? picked : data.current;
  const idx = months.indexOf(selected);
  const older = idx >= 0 && idx + 1 < months.length ? months[idx + 1] : undefined;
  const newer = idx > 0 ? months[idx - 1] : undefined;

  return (
    <div className="usage-panel">
      <div className="usage-nav">
        <strong>{fmtMonth(selected)}{selected === data.current ? '（本月）' : ''}</strong>
        <span className="usage-nav-btns">
          {older && <button className="as-small" onClick={() => setPicked(older)}>看上個月 <IconChevronRight size={16} /></button>}
          {newer && <button className="as-small" onClick={() => setPicked(newer)}><IconChevronLeft size={16} /> 下個月</button>}
          {selected !== data.current && <button className="as-small" onClick={() => setPicked(null)}>回本月</button>}
        </span>
      </div>
      <MonthBody data={data} month={selected} />
      {data.ttsCache && (
        <div className="usage-row">
          <div className="usage-line">
            <span>{ttsCacheLine(data.ttsCache)}</span>
            <button className="as-small" onClick={() => { void clearTtsCache().then(load); }}>清除語音快取</button>
          </div>
        </div>
      )}
      <small className="usage-note">僅統計這台電腦伺服器經手的請求；以官方帳單為準。費用為估算（內建價格表，1 USD ≈ 32 TWD 固定匯率）。</small>
    </div>
  );
}
