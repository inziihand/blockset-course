import { BookOpen, LogIn, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { portalHost } from '../portalHost';
import { useAppActive } from '../../../shared/lifecycle/AppActivity';

type CourseAccessDialogProps = {
  feature: string;
  isSignedIn: boolean;
  onClose: () => void;
  onOpenAccount?: () => void;
};

export default function CourseAccessDialog({
  feature,
  isSignedIn,
  onClose,
  onOpenAccount,
}: CourseAccessDialogProps) {
  if (!useAppActive()) return null;
  return createPortal(
    <div className="modal-backdrop" onPointerDown={onClose}>
      <section
        className="modal-card course-access-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="course-access-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="course-access-mark" aria-hidden="true"><BookOpen size={24} strokeWidth={2} /></div>
        <div className="course-access-copy">
          <small>課程學員功能</small>
          <h2 id="course-access-title">{feature}</h2>
          <p>這項進階分析屬於選擇權課程教材。公開版仍可使用手動組合、損益曲線、到期價值與所有刻度模式；課程模板、Greeks 曲線及多曲線比較需開通後使用。</p>
          <p className="course-access-help">測試階段由管理員在「管理功能」為會員開通教材權限。</p>
        </div>
        <div className="modal-actions course-access-actions">
          <button type="button" className="ghost-button" onClick={onClose}>繼續使用公開版</button>
          {onOpenAccount ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                onClose();
                onOpenAccount();
              }}
            >
              <LogIn size={16} strokeWidth={2} />
              {isSignedIn ? '查看會員狀態' : '登入／查看權限'}
            </button>
          ) : null}
        </div>
        <button type="button" className="modal-close course-access-close" onClick={onClose} aria-label="關閉課程權限說明">
          <X size={18} strokeWidth={2} />
        </button>
      </section>
    </div>,
    portalHost(),
  );
}
