// Store-connected versions of the prototype components every screen header uses (C.gamebar,
// C.levelpill, C.avatarBtn, C.userPic, C.demoBadge): they read the store, so they
// refresh on their own when an award lands (app.points redrew the gamebar the same way).
import { AvatarBtn, DemoBadge, Gamebar, LevelPill, type PicProfile, UserPic } from '@tie/ui';
import { aiOnline } from '../core/aiClient';
import { catalogImage } from '../store/content';
import { gameView } from '../store/game';
import { state } from '../store/state';

/** The profile picture source: uploaded photo, else the catalog's generated avatar user-N. */
export function picProfile(): PicProfile {
  const p = state.value.profile;
  const n = p?.avatar || 1;
  const photo = p?.photo || catalogImage(`avatar/user-${n}`) || null;
  return { photo, avatar: n };
}

/** C.gamebar: streak / points / today's goal. */
export function LiveGamebar() {
  return <Gamebar g={gameView.value} />;
}

/** C.levelpill */
export function LiveLevelPill() {
  return <LevelPill level={gameView.value.level} />;
}

/** C.avatarBtn: top-right avatar that opens Perfil. */
export function UserAvatarBtn() {
  return <AvatarBtn profile={picProfile()} />;
}

/** C.userPic(size) */
export function UserPicture({ size = 42 }: { size?: number }) {
  return <UserPic profile={picProfile()} size={size} />;
}

/** C.demoBadge: "IA ligada" / "Modo demo" from ai.online. */
export function AiBadge() {
  return <DemoBadge online={aiOnline.value} />;
}
