import { uiConfig } from '../config';
import { Icon } from '../icons';
import { activator } from './act';

/** The profile fields the picture needs (TieState.profile). */
export type PicProfile = { photo?: string | null; avatar?: number } | null | undefined;

export function userPicSrc(profile: PicProfile): string {
  return profile?.photo || `${uiConfig.avatarDir}user-${profile?.avatar || 1}.webp`;
}

/** C.userPic: uploaded photo or the generated avatar user-N.webp. */
export function UserPic({ profile, size = 42 }: { profile: PicProfile; size?: number }) {
  return <img class="userpic" src={userPicSrc(profile)} alt="" style={{ width: `${size}px`, height: `${size}px` }} />;
}

/** C.avatarBtn: top-right avatar that opens Perfil (mobile has no Você tab). */
export function AvatarBtn({ profile }: { profile: PicProfile }) {
  return (
    <button
      type="button"
      class="avatarbtn"
      aria-label="Perfil"
      title="Seu perfil"
      onClick={activator('perfil', undefined)}
    >
      <UserPic profile={profile} size={42} />
      <span class="ed">
        <Icon name="profile" size={11} />
      </span>
    </button>
  );
}

/** C.demoBadge: "IA ligada" when /api/health reports AI, else "Modo demo". */
export function DemoBadge({ online }: { online: boolean }) {
  return online ? (
    <span class="demo-badge live">
      <i />
      IA ligada
    </span>
  ) : (
    <span class="demo-badge">
      <i />
      Modo demo
    </span>
  );
}
