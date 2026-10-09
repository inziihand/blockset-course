import { useState } from 'react';
import { LogIn, LogOut, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '../shared/auth';
import { useSiteSettings } from '../shared/site/SiteSettingsProvider';

export default function DrawerAuthPanel() {
  const { settings } = useSiteSettings();
  const {
    user, status, error: authError, member, identityStatus, identityError,
    signInWithGoogle, signOut, retryIdentitySync,
  } = useAuth();
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');

  const perform = async (action: () => Promise<void>) => {
    setPending(true);
    setActionError('');
    try { await action(); }
    catch { setActionError('無法完成帳戶操作，請依下方訊息檢查設定。'); }
    finally { setPending(false); }
  };

  if (status === 'unconfigured') return <section className="drawer-auth-section" aria-label="會員帳號">
    <div className="drawer-account-summary">
      <span className="drawer-account-avatar"><UserRound size={19} aria-hidden="true" /></span>
      <span><b>Firebase Auth 尚未設定</b><small>填寫根目錄 .env.local 後可啟用 Google 登入</small></span>
    </div>
    <button type="button" className="drawer-auth-button" disabled>
      <span className="drawer-google-mark" aria-hidden="true">G</span><LogIn size={16} aria-hidden="true" />
      以 Google 帳號登入
    </button>
  </section>;

  return <section className="drawer-auth-section" aria-label="會員帳號">
    {user ? <>
      <div className="drawer-account-summary">
        {user.photoURL
          ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />
          : <span className="drawer-account-avatar">{(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}</span>}
        <span><b>{user.displayName || `${settings.title} 使用者`}</b><small>{user.email || '已使用 Google 帳號登入'}</small></span>
      </div>
      <p className="drawer-auth-boundary"><ShieldCheck size={14} aria-hidden="true" />{
        identityStatus === 'syncing' ? '正在同步平台權限…'
          : member?.role === 'admin' ? '平台管理員 · 權限由 Identity API 驗證'
            : member ? '平台會員 · 權限由 Identity API 驗證'
              : '登入只確認身分；管理權限仍由後端驗證。'
      }</p>
      <button type="button" className="drawer-auth-button" disabled={pending} onClick={() => void perform(signOut)}>
        <LogOut size={16} aria-hidden="true" />{pending ? '正在登出…' : '登出'}
      </button>
      {identityStatus === 'error' && <button type="button" className="drawer-auth-button" onClick={retryIdentitySync}>
        <RefreshCw size={16} aria-hidden="true" />重新同步權限
      </button>}
    </> : <>
      <div className="drawer-auth-copy"><b>登入 {settings.title}</b><small>使用 Firebase Authentication 的 Google 登入。</small></div>
      <button type="button" className="drawer-auth-button" disabled={status !== 'ready' || pending}
        onClick={() => void perform(signInWithGoogle)}>
        <span className="drawer-google-mark" aria-hidden="true">G</span><LogIn size={16} aria-hidden="true" />
        {status === 'loading' ? '正在確認登入狀態…' : pending ? '正在開啟 Google…' : '以 Google 帳號登入'}
      </button>
    </>}
    {(actionError || authError || identityError) && <p className="drawer-auth-error" role="alert">{authError || identityError || actionError}</p>}
  </section>;
}
