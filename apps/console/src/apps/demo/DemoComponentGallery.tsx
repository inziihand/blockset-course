import { useId, useState, type CSSProperties } from 'react';
import { CalendarDays, Gauge, Layers3, SlidersHorizontal } from 'lucide-react';
import { DatePicker, MenuPopover, SegmentedControl, type MenuOption } from '../../shared/ui/patterns';
import DemoDataWorkspace from './DemoDataWorkspace';

type TemplateKey = 'form-preview' | 'list-detail' | 'monitoring' | 'compact-form' | 'dense-table' | 'workflow' | 'notifications';
type ViewKey = 'summary' | 'trend' | 'distribution' | 'comparison' | 'change' | 'quality' | 'status';

const templates: readonly MenuOption<TemplateKey>[] = [
  { value: 'form-preview', label: '表單與預覽', icon: <Layers3 size={15} /> },
  { value: 'list-detail', label: '清單與明細', icon: <Layers3 size={15} /> },
  { value: 'monitoring', label: '監控儀表板', icon: <Layers3 size={15} /> },
  { value: 'compact-form', label: '窄版表單', icon: <Layers3 size={15} /> },
  { value: 'dense-table', label: '高密度表格', icon: <Layers3 size={15} /> },
  { value: 'workflow', label: '工作流程', icon: <Layers3 size={15} /> },
  { value: 'notifications', label: '通知中心', icon: <Layers3 size={15} /> },
];

const views: readonly { value: ViewKey; label: string }[] = [
  { value: 'summary', label: '摘要' },
  { value: 'trend', label: '趨勢' },
  { value: 'distribution', label: '分布' },
  { value: 'comparison', label: '比較' },
  { value: 'change', label: '變化' },
  { value: 'quality', label: '品質' },
  { value: 'status', label: '狀態' },
];

const DEMO_END_DATE = '2026-09-17';

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return value.replaceAll('-', '/');
}

function RangeControl({ label, hint, min, max, step, value, unit, onChange }: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return <div className="demo-range-control">
    <div className="demo-range-heading"><label htmlFor={id}>{label}</label><small>{hint}</small></div>
    <div className="demo-range-line">
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))} />
      <output htmlFor={id}>{value}{unit}</output>
    </div>
    <div className="demo-range-scale" aria-hidden="true"><span>{min}{unit}</span><span>{max}{unit}</span></div>
  </div>;
}

function DemoGauge({ label, value, valueLabel, tag, note }: {
  label: string;
  value: number;
  valueLabel: string;
  tag: string;
  note: string;
}) {
  const gradientId = `demo-gauge-${useId().replaceAll(':', '')}`;
  const ratio = Math.max(0, Math.min(1, value / 100));
  const angle = -90 + ratio * 180;
  const style = {
    '--demo-gauge-angle': `${angle}deg`,
    '--demo-gauge-ratio': `${ratio * 100}%`,
  } as CSSProperties;
  return <figure className="demo-gauge" style={style} aria-label={`${label} ${valueLabel}`}>
    <figcaption><span>{label}</span><strong>{tag}</strong></figcaption>
    <svg className="demo-gauge-svg" viewBox="0 0 200 120" aria-hidden="true">
      <defs><linearGradient id={gradientId} x1="0" x2="1">
        <stop offset="0" stopColor="var(--demo-gauge-low)" />
        <stop offset=".55" stopColor="var(--demo-gauge-good)" />
        <stop offset="1" stopColor="var(--demo-gauge-high)" />
      </linearGradient></defs>
      <path className="demo-gauge-track" d="M20 100 A80 80 0 0 1 180 100" />
      <path className="demo-gauge-zone" d="M20 100 A80 80 0 0 1 180 100" stroke={`url(#${gradientId})`} />
      <g className="demo-gauge-needle"><line x1="100" y1="100" x2="100" y2="45" /><circle cx="100" cy="100" r="8" /><circle cx="100" cy="100" r="3" /></g>
    </svg>
    <div className="demo-gauge-mobile" aria-hidden="true"><span /></div>
    <div className="demo-gauge-reading"><strong>{valueLabel}</strong><span>{value}%</span></div>
    <small>{note}</small>
  </figure>;
}

export default function DemoComponentGallery() {
  const [source, setSource] = useState('workspace-a');
  const [template, setTemplate] = useState<TemplateKey>('form-preview');
  const [view, setView] = useState<ViewKey>('summary');
  const [density, setDensity] = useState(28);
  const [refreshSeconds, setRefreshSeconds] = useState(15);
  const [threshold, setThreshold] = useState(70);
  const [preset, setPreset] = useState('30d');
  const [startDate, setStartDate] = useState(shiftDate(DEMO_END_DATE, -30));
  const [endDate, setEndDate] = useState(DEMO_END_DATE);
  const [appliedRange, setAppliedRange] = useState({ start: startDate, end: endDate });

  const choosePreset = (key: string, days: number) => {
    setPreset(key);
    setStartDate(shiftDate(DEMO_END_DATE, -days));
    setEndDate(DEMO_END_DATE);
  };

  const completeness = Math.min(99, 68 + Math.round(density * .65));
  const interfaceLoad = Math.min(100, Math.round((density / 48) * 100));
  const freshness = Math.max(10, 100 - refreshSeconds * 2);

  return <section className="demo-component-lab" aria-labelledby="demo-component-lab-title">
    <header className="demo-component-lab-heading">
      <div><span>03 · COMPONENT GALLERY</span><h3 id="demo-component-lab-title">互動元件圖鑑</h3></div>
      <p>參考既有介面語彙的離線元件展示，不代表帳戶、行情或交易功能已接入。</p>
    </header>

    <div className="demo-component-grid">
      <article className="demo-control-card">
        <div className="demo-control-card-heading"><Layers3 size={17} aria-hidden="true" /><div><h4>選擇與選單</h4><p>原生選擇器與鍵盤可操作的自訂選單。</p></div></div>
        <div className="demo-control-stack">
          <div className="demo-field-control">
            <div className="demo-field-copy"><label htmlFor="demo-data-source">展示資料來源</label><small>純介面範例，不連接帳戶</small></div>
            <select id="demo-data-source" value={source} onChange={(event) => setSource(event.currentTarget.value)}>
              <option value="workspace-a">離線工作區 A</option>
              <option value="workspace-b">離線工作區 B</option>
              <option value="archived">封存範例</option>
            </select>
          </div>
          <MenuPopover label="版面模板" value={template} options={templates}
            triggerIcon={<Layers3 size={15} aria-hidden="true" />} onChange={setTemplate} />
        </div>
        <p className="demo-selection-summary" aria-live="polite">目前選擇：{source === 'workspace-a' ? '離線工作區 A' : source === 'workspace-b' ? '離線工作區 B' : '封存範例'} · {templates.find((item) => item.value === template)?.label}</p>
      </article>

      <article className="demo-control-card">
        <div className="demo-control-card-heading"><Gauge size={17} aria-hidden="true" /><div><h4>分段檢視</h4><p>同一份內容的不同觀察角度。</p></div></div>
        <SegmentedControl id="demo-view-tab" ariaLabel="示範檢視" items={views}
          value={view} panelId="demo-view-panel" onChange={setView} />
        <div id="demo-view-panel" className="demo-segment-preview" role="tabpanel"
          aria-labelledby={`demo-view-tab-${view}`}>
          <span>{views.find((item) => item.value === view)?.label}</span>
          <strong>{view === 'summary' ? '8 個重點' : view === 'trend' ? '近 30 天' : view === 'distribution' ? '4 個區間' : view === 'comparison' ? '3 組差異' : view === 'change' ? '+4.7%' : view === 'quality' ? '92 分' : '全部正常'}</strong>
          <small>切換只更新 Demo 內部狀態。</small>
        </div>
      </article>

      <article className="demo-control-card">
        <div className="demo-control-card-heading"><SlidersHorizontal size={17} aria-hidden="true" /><div><h4>參數滑桿</h4><p>數值、範圍與即時輸出保持在同一列。</p></div></div>
        <RangeControl label="顯示密度" hint="調整範例項目數" min={12} max={48} step={4} value={density} unit=" 筆" onChange={setDensity} />
        <RangeControl label="更新間隔" hint="僅改變示意數值" min={5} max={45} step={5} value={refreshSeconds} unit=" 秒" onChange={setRefreshSeconds} />
        <RangeControl label="警示門檻" hint="展示百分比輸入" min={20} max={90} step={5} value={threshold} unit="%" onChange={setThreshold} />
      </article>

      <article className="demo-control-card">
        <div className="demo-control-card-heading"><CalendarDays size={17} aria-hidden="true" /><div><h4>日期範圍</h4><p>快速區間與自訂日期可並存。</p></div></div>
        <div className="demo-date-presets" role="group" aria-label="日期快速區間">
          {[{ key: '1d', label: '1 天', days: 1 }, { key: '7d', label: '1 週', days: 7 }, { key: '30d', label: '1 個月', days: 30 }, { key: '90d', label: '3 個月', days: 90 }, { key: '180d', label: '6 個月', days: 180 }, { key: '1y', label: '1 年', days: 365 }, { key: '5y', label: '5 年', days: 1825 }, { key: 'all', label: '全部', days: 2555 }].map((item) =>
            <button type="button" key={item.key} aria-pressed={preset === item.key} onClick={() => choosePreset(item.key, item.days)}>{item.label}</button>)}
          <button type="button" aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')}>自訂日期</button>
        </div>
        <div className="demo-date-fields">
          <DatePicker label="開始日期" value={startDate} max={endDate}
            footerStart="固定示範日期" footerEnd={<>可選至 {formatDate(endDate)}</>}
            onChange={(value) => { setPreset('custom'); setStartDate(value); }} />
          <span aria-hidden="true">至</span>
          <DatePicker label="結束日期" value={endDate} min={startDate} max={DEMO_END_DATE} align="end"
            footerStart="固定示範日期" footerEnd={<>可選至 {formatDate(DEMO_END_DATE)}</>}
            onChange={(value) => { setPreset('custom'); setEndDate(value); }} />
          <button type="button" className="demo-apply-date" onClick={() => setAppliedRange({ start: startDate, end: endDate })}>套用</button>
        </div>
        <p className="demo-date-summary" aria-live="polite">已套用日期：{formatDate(appliedRange.start)} 至 {formatDate(appliedRange.end)}</p>
      </article>
    </div>

    <section className="demo-gauge-panel" aria-labelledby="demo-gauge-title">
      <header><div><span>STATUS VISUALIZATION</span><h4 id="demo-gauge-title">儀表與狀態</h4></div><p>由上方 Demo 參數即時計算，不是服務監控資料。</p></header>
      <div className="demo-gauge-grid">
        <DemoGauge label="資料完整度" value={completeness} valueLabel={`${completeness}%`} tag="示範良好" note={`顯示密度 ${density} 筆`} />
        <DemoGauge label="介面負荷" value={interfaceLoad} valueLabel={`${interfaceLoad}%`} tag={interfaceLoad > threshold ? '超過門檻' : '門檻內'} note={`警示門檻 ${threshold}%`} />
        <DemoGauge label="快照新鮮度" value={freshness} valueLabel={`${freshness}%`} tag="離線估算" note={`更新間隔 ${refreshSeconds} 秒`} />
      </div>
    </section>
    <DemoDataWorkspace />
  </section>;
}
