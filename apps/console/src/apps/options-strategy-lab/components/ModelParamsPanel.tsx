import type { ModelParams } from '../types';
import { CARRY_RATE_RANGE, EXPIRY_DAYS_RANGE } from '../constants';
import DatePickerButton from './DatePickerButton';
import SliderRow from './SliderRow';

function ParameterPanel({ params, setParams, onOpenIvCalculator }: { params: ModelParams; setParams: React.Dispatch<React.SetStateAction<ModelParams>>; onOpenIvCalculator: () => void }) {
  const set = (patch: Partial<ModelParams>) => setParams((prev) => ({ ...prev, ...patch }));
  const expiryCalendarAction = (
    <span className="expiry-calendar-control">
      <DatePickerButton days={params.days} onChangeDays={(days) => set({ days })} ariaLabel="選擇到期日" />
    </span>
  );

  return (
    <section className="card param-card">
      <div className="card-header compact">
        <h2>模型參數</h2>
      </div>
      <SliderRow label="隱含波動率 IV" value={params.iv} min={0.05} max={0.8} step={0.01} suffix="%" onChange={(iv) => set({ iv })} onHelpClick={onOpenIvCalculator} helpLabel="開啟 IV 反推計算器" showScale={false} />
      <SliderRow
        label="到期日（剩餘天數）"
        value={params.days}
        {...EXPIRY_DAYS_RANGE}
        step={1}
        suffix="天"
        onChange={(days) => set({ days })}
        helpText="可用滑桿或日曆調整剩餘天數，最少 1 天。到期損益可用「到期價值」曲線查看。"
        actions={expiryCalendarAction}
      />
      <SliderRow
        label="無風險利率 r（%）"
        value={params.carryRate}
        {...CARRY_RATE_RANGE}
        onChange={(carryRate) => set({ carryRate })}
        helpText="Black–Scholes 模型中的無風險利率 r；目前假設股利殖利率 q = 0"
        showScale={false}
      />
    </section>
  );
}

export { ParameterPanel };
export default ParameterPanel;
