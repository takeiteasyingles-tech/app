import { z } from 'zod';

/** Every error response from /api and /admin-api has this body: {error:{code,message,details?}}. */
export const ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'unauthorized',
  'session_expired',
  'forbidden',
  'csrf_failed',
  'turnstile_failed',
  'invalid_credentials',
  'account_locked',
  'account_suspended',
  'email_taken',
  'weak_password',
  'token_invalid',
  'not_found',
  'conflict',
  'gated',
  'in_use',
  'payload_too_large',
  'unsupported_media_type',
  'rate_limited',
  'quota_exceeded',
  'plan_required',
  'content_unavailable',
  'ai_unavailable',
  'internal',
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ERROR_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 400,
  unauthorized: 401,
  session_expired: 401,
  forbidden: 403,
  csrf_failed: 403,
  turnstile_failed: 403,
  invalid_credentials: 401,
  account_locked: 423,
  account_suspended: 403,
  email_taken: 409,
  weak_password: 400,
  token_invalid: 400,
  not_found: 404,
  conflict: 409,
  gated: 409,
  in_use: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  quota_exceeded: 429,
  plan_required: 403,
  content_unavailable: 404,
  ai_unavailable: 503,
  internal: 500,
};

/** Default user-facing copy (pt-BR). Routes may pass a more specific message. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  bad_request: 'Pedido inválido.',
  validation_failed: 'Confira os dados e tente de novo.',
  unauthorized: 'Entre na sua conta para continuar.',
  session_expired: 'Sua sessão expirou. Entre de novo.',
  forbidden: 'Você não tem permissão para isso.',
  csrf_failed: 'Pedido bloqueado por segurança. Recarregue a página.',
  turnstile_failed: 'Não deu para confirmar que você não é um robô. Tente de novo.',
  invalid_credentials: 'E-mail ou senha incorretos.',
  account_locked: 'Muitas tentativas. Tente de novo em 15 minutos.',
  account_suspended: 'Esta conta está suspensa. Fale com o suporte.',
  email_taken: 'Já existe uma conta com este e-mail.',
  weak_password: 'Escolha uma senha mais forte.',
  token_invalid: 'Este link expirou ou já foi usado.',
  not_found: 'Não encontrado.',
  conflict: 'Isso mudou enquanto você editava. Recarregue e tente de novo.',
  gated: 'Termine a etapa atual antes de seguir.',
  in_use: 'Este item ainda está em uso.',
  payload_too_large: 'Arquivo grande demais.',
  unsupported_media_type: 'Formato de arquivo não aceito.',
  rate_limited: 'Muitos pedidos seguidos. Espere um pouco.',
  quota_exceeded: 'Seus minutos de conversa deste mês acabaram.',
  plan_required: 'Este conteúdo faz parte de outro plano.',
  content_unavailable: 'Este conteúdo ainda não está disponível.',
  ai_unavailable: 'A IA está fora do ar agora. Seguimos no modo demo.',
  internal: 'Algo deu errado do nosso lado. Tente de novo.',
};

export const ErrorBody = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.unknown().optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export const ErrorEnvelope = z.object({ error: ErrorBody });
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

/** Throwable carrier for an error envelope; the Worker error handler turns it into a response. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }

  toEnvelope(): ErrorEnvelope {
    const error: ErrorBody = { code: this.code, message: this.message };
    if (this.details !== undefined) error.details = this.details;
    return { error };
  }
}

export function errorEnvelope(code: ErrorCode, message?: string, details?: unknown): ErrorEnvelope {
  return new ApiError(code, message, details).toEnvelope();
}

export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return ErrorEnvelope.safeParse(value).success;
}
