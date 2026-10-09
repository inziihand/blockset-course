import { OptionsStrategyLab } from './OptionsStrategyLab';
import { useAuth } from '../../shared/auth';
import { hasAppEntitlement } from '../../shared/auth/identityClient';
import type { ShellAppProps } from '../../shell/types';
import './options-strategy-lab.css';
import './options-strategy-platform.css';

export default function OptionsStrategyLabApp({ onOpenAppMenu }: ShellAppProps) {
  const { user, member, identityStatus } = useAuth();
  const trustedMember = identityStatus === 'ready' && user?.uid === member?.uid ? member : null;
  const isActiveMember = trustedMember?.status === 'active';
  const hasCourseAccess = hasAppEntitlement(trustedMember, 'options-strategy-lab', 'course');

  return (
    <OptionsStrategyLab
      onOpenAppMenu={onOpenAppMenu}
      hasCourseAccess={hasCourseAccess}
      isSignedIn={isActiveMember}
      userId={isActiveMember ? trustedMember.uid : null}
    />
  );
}
