import { Fragment, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Info,
  RefreshCw,
  Search,
  Star,
  Table2,
} from 'lucide-react';
import { FolderTabs, StatusBanner } from '../../shared/ui/patterns';

type SectionKey = 'items' | 'activity' | 'settings';
type DataView = 'list' | 'categories';
type FilterKey = 'all' | 'favorites' | 'form' | 'table' | 'status';
type SortKey = 'name' | 'progress' | 'trend' | 'items';

type DemoRow = {
  id: string;
  name: string;
  kind: Exclude<FilterKey, 'all' | 'favorites'>;
  kindLabel: string;
  context: string;
  progress: number;
  refresh: string;
  trend: number;
  items: number;
  description: string;
};

const rows: readonly DemoRow[] = [
  { id: 'form-preview', name: '表單與預覽', kind: 'form', kindLabel: '表單', context: '通用版', progress: 92, refresh: '手動', trend: 4.7, items: 1284, description: '欄位、確認視窗與套用後預覽的組合範例。' },
  { id: 'list-detail', name: '清單與明細', kind: 'table', kindLabel: '資料表', context: '通用版', progress: 86, refresh: '30 秒', trend: 1.2, items: 846, description: '篩選、排序、收藏與展開列的組合範例。' },
  { id: 'monitoring', name: '監控儀表板', kind: 'status', kindLabel: '狀態', context: '寬版', progress: 78, refresh: '15 秒', trend: -0.8, items: 312, description: '摘要數值、狀態標記與視覺化儀表的組合範例。' },
  { id: 'compact-form', name: '窄版表單', kind: 'form', kindLabel: '表單', context: '窄版', progress: 95, refresh: '手動', trend: 2.3, items: 168, description: '單欄堆疊、滿寬操作與手機輸入欄位的範例。' },
  { id: 'dense-table', name: '高密度表格', kind: 'table', kindLabel: '資料表', context: '桌面版', progress: 71, refresh: '60 秒', trend: -1.6, items: 2560, description: '大量欄位、數值對齊及窄畫面欄位降級的範例。' },
  { id: 'notice-center', name: '通知與狀態', kind: 'status', kindLabel: '狀態', context: '全尺寸', progress: 89, refresh: '事件觸發', trend: 0, items: 24, description: '資訊、警告、錯誤及成功回饋的展示集合。' },
];

const sectionTabs: readonly { value: SectionKey; label: string }[] = [
  { value: 'items', label: '資料項目' },
  { value: 'activity', label: '活動紀錄' },
  { value: 'settings', label: '檢視設定' },
];

const dataViews: readonly { value: DataView; label: string }[] = [
  { value: 'list', label: '元件清單' },
  { value: 'categories', label: '分類說明' },
];

function formatItems(value: number) {
  return new Intl.NumberFormat('zh-TW').format(value);
}

export default function DemoDataWorkspace() {
  const [section, setSection] = useState<SectionKey>('items');
  const [view, setView] = useState<DataView>('list');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(() => new Set(['form-preview', 'list-detail']));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('items');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [dataset, setDataset] = useState('component-library');
  const [revision, setRevision] = useState(1);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-TW');
    const filtered = rows.filter((row) =>
      (filter === 'all' || filter === 'favorites' && favorites.has(row.id) || row.kind === filter)
      && (!normalizedQuery || `${row.name} ${row.kindLabel} ${row.context}`.toLocaleLowerCase('zh-TW').includes(normalizedQuery)));
    return [...filtered].sort((left, right) => {
      const comparison = sort === 'name' ? left.name.localeCompare(right.name, 'zh-TW') : left[sort] - right[sort];
      return direction === 'asc' ? comparison : -comparison;
    });
  }, [direction, favorites, filter, query, sort]);

  const toggleSort = (next: SortKey) => {
    if (sort === next) setDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else { setSort(next); setDirection(next === 'name' ? 'asc' : 'desc'); }
  };

  const toggleFavorite = (id: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const sortButton = (key: SortKey, label: string) => <button type="button" onClick={() => toggleSort(key)}
    aria-label={`依${label}排序`}>{label}{sort === key ? direction === 'asc' ? ' ↑' : ' ↓' : ''}</button>;

  return <section className="demo-data-workspace" aria-labelledby="demo-data-workspace-title">
    <header className="demo-data-workspace-title">
      <div><span>COMPOSED DATA VIEW</span><h3 id="demo-data-workspace-title">離線資料工作區</h3></div>
      <p>展示資訊層級、頁籤、工具列及資料表；所有內容均為本機固定範例。</p>
    </header>

    <div className="demo-context-bar">
      <div className="demo-context-identity"><Table2 size={17} aria-hidden="true" /><span><strong>元件展示資料</strong><small>離線、唯讀、不送出命令</small></span></div>
      <label><span>展示資料集</span><select value={dataset} onChange={(event) => setDataset(event.currentTarget.value)}>
        <option value="component-library">元件資料庫</option>
        <option value="layout-library">版面資料庫</option>
      </select></label>
      <div className="demo-context-badges"><span>純前端</span><span>固定範例</span></div>
    </div>

    <StatusBanner title="離線資料已載入" icon={<Info size={16} />}
      action={<button type="button" onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14} aria-hidden="true" />更新範例</button>}>
      目前顯示第 {revision} 版範例；更新按鈕只改變 Demo 本機狀態。
    </StatusBanner>

    <div className="platform-folder-stack">
      <FolderTabs id="demo-data-section-tab" ariaLabel="離線資料工作區導覽" items={sectionTabs}
        value={section} columns={3} panelId="demo-folder-panel" onChange={setSection} />
      <div id="demo-folder-panel" className="platform-folder-panel" role="tabpanel"
        aria-labelledby={`demo-data-section-tab-${section}`}>
      {section !== 'items' ? <div className="demo-placeholder-panel">
        <strong>{section === 'activity' ? '活動紀錄範例' : '檢視設定範例'}</strong>
        <p>{section === 'activity' ? '可在此放置時間軸、稽核紀錄或事件清單。' : '可在此放置欄位顯示、密度與排序偏好。'}</p>
      </div> : <>
        <FolderTabs id="demo-data-view-tab" ariaLabel="資料項目檢視" items={dataViews}
          value={view} columns={2} panelId="demo-nested-folder-panel" onChange={setView} />
        <div id="demo-nested-folder-panel" className="demo-nested-folder-panel" role="tabpanel"
          aria-labelledby={`demo-data-view-tab-${view}`}>
          {view === 'categories' ? <div className="demo-category-grid">
            <article><strong>表單</strong><span>欄位、日期、滑桿與確認流程</span></article>
            <article><strong>資料表</strong><span>篩選、排序、收藏與展開明細</span></article>
            <article><strong>狀態</strong><span>提示列、徽章、進度與儀表</span></article>
          </div> : <>
            <div className="demo-table-toolbar">
              <div className="demo-table-filters" role="group" aria-label="元件資料篩選">
                {([
                  ['all', '所有'], ['favorites', '收藏'], ['form', '表單'], ['table', '資料表'], ['status', '狀態'],
                ] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key}
                  onClick={() => { setFilter(key); setExpanded(null); }}>{key === 'favorites' ? <Star size={13} aria-hidden="true" /> : null}{label}</button>)}
              </div>
              <label className="demo-table-search"><Search size={14} aria-hidden="true" /><span className="demo-visually-hidden">搜尋元件資料</span>
                <input type="search" placeholder="搜尋項目…" value={query} onChange={(event) => { setQuery(event.currentTarget.value); setExpanded(null); }} /></label>
            </div>
            <div className="demo-table-caption">
              <span><strong>{visibleRows.length}</strong> 筆範例 · {favorites.size} 個收藏 · 第 {revision} 版</span>
              <span>固定時間 2026/09/17 12:21:{String(35 + revision).padStart(2, '0')}</span>
            </div>
            <div className="demo-table-scroll" role="region" aria-label="元件展示資料表" tabIndex={0}>
              <table className="demo-data-table">
                <thead><tr>
                  <th scope="col">{sortButton('name', '項目')}</th>
                  <th scope="col" className="demo-table-kind">類型</th>
                  <th scope="col">{sortButton('progress', '完成度')}</th>
                  <th scope="col" className="demo-table-frequency">更新</th>
                  <th scope="col">{sortButton('trend', '變化')}</th>
                  <th scope="col" className="demo-table-items">{sortButton('items', '範例筆數')}</th>
                </tr></thead>
                <tbody>{visibleRows.map((row) => {
                  const isExpanded = expanded === row.id;
                  return <Fragment key={row.id}>
                    <tr className={isExpanded ? 'is-expanded' : undefined}>
                      <th scope="row"><div className="demo-table-name">
                        <button type="button" className="demo-table-star" aria-pressed={favorites.has(row.id)}
                          aria-label={`${favorites.has(row.id) ? '取消收藏' : '收藏'} ${row.name}`} onClick={() => toggleFavorite(row.id)}>
                          <Star size={14} fill={favorites.has(row.id) ? 'currentColor' : 'none'} aria-hidden="true" />
                        </button>
                        <button type="button" className="demo-table-expand" aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? '收合' : '展開'} ${row.name}`} onClick={() => setExpanded(isExpanded ? null : row.id)}>
                          <span><strong>{row.name}</strong><small>{row.context}</small></span>
                          {isExpanded ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                        </button>
                      </div></th>
                      <td className="demo-table-kind">{row.kindLabel}</td>
                      <td><strong>{row.progress}%</strong></td>
                      <td className="demo-table-frequency">{row.refresh}</td>
                      <td className={row.trend > 0 ? 'is-positive' : row.trend < 0 ? 'is-negative' : undefined}>{row.trend > 0 ? '+' : ''}{row.trend.toFixed(1)}%</td>
                      <td className="demo-table-items">{formatItems(row.items)}</td>
                    </tr>
                    {isExpanded && <tr className="demo-table-detail-row"><td colSpan={6}>
                      <section className="demo-table-detail" aria-label={`${row.name} 範例明細`}>
                        <div><span>範例說明</span><strong>{row.description}</strong></div>
                        <div><span>建議版面</span><strong>{row.context}</strong></div>
                        <div><span>資料性質</span><strong>固定離線資料</strong></div>
                      </section>
                    </td></tr>}
                  </Fragment>;
                })}</tbody>
              </table>
            </div>
            {visibleRows.length === 0 && <div className="demo-table-empty"><strong>沒有符合條件的項目</strong><p>請調整分類或搜尋文字。</p></div>}
          </>}
        </div>
      </>}
      </div>
    </div>
  </section>;
}
