// pfPhoto: the picked image is cropped to a centered 256×256 JPEG on the client (as the prototype did)
// and uploaded to POST /api/me/photo (private R2 + moderation queue). The store shows the local
// preview at once and switches to the server URL when the upload lands.
import { LIMITS } from '@tie/shared/constants';
import { meApi } from '@tie/shared/contracts/me';
import { toast } from '@tie/ui';
import { call, errorMessage } from '../../api';
import { set, state } from '../../store';

/** Scale and offset that cover an S×S square with a w×h image (center crop). */
export function coverBox(
  w: number,
  h: number,
  S: number = LIMITS.photoSize,
): { dw: number; dh: number; x: number; y: number } {
  const k = Math.max(S / w, S / h);
  const dw = w * k;
  const dh = h * k;
  return { dw, dh, x: (S - dw) / 2, y: (S - dh) / 2 };
}

function decode(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode'));
    };
    img.src = url;
  });
}

/** 256×256 JPEG (quality .85) of the center of the image. */
export async function resizePhoto(file: Blob): Promise<Blob> {
  const img = await decode(file);
  const S = LIMITS.photoSize;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas');
  const b = coverBox(img.naturalWidth || img.width, img.naturalHeight || img.height, S);
  g.drawImage(img, b.x, b.y, b.dw, b.dh);
  return new Promise((resolve, reject) =>
    c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode'))), 'image/jpeg', 0.85),
  );
}

const setPhoto = (photo: string | null) => set((s) => (s.profile ? { profile: { ...s.profile, photo } } : undefined));

/** pfPhoto(file) */
export async function uploadPhoto(file: File): Promise<void> {
  const before = state.value.profile?.photo ?? null;
  let blob: Blob;
  try {
    blob = await resizePhoto(file);
  } catch {
    toast('Não deu para ler esta imagem. Tente outra foto.');
    return;
  }
  const preview = URL.createObjectURL(blob);
  setPhoto(preview);
  const form = new FormData();
  form.append(meApi.photoUpload.multipart.field, blob, 'foto.jpg');
  try {
    const r = await call(meApi.photoUpload, { form });
    setPhoto(r.photo);
    toast('Foto atualizada.');
  } catch (err) {
    if (state.value.profile?.photo === preview) setPhoto(before);
    toast(errorMessage(err));
  } finally {
    setTimeout(() => URL.revokeObjectURL(preview), 10_000);
  }
}

/** pfPhotoClear / choosing an avatar: back to the generated avatar, the upload is retired. */
export async function clearPhoto(): Promise<void> {
  const before = state.value.profile?.photo ?? null;
  if (!before) return;
  setPhoto(null);
  try {
    await call(meApi.photoDelete);
  } catch (err) {
    if (!state.value.profile?.photo) setPhoto(before);
    toast(errorMessage(err));
  }
}
