import type { Env } from '../env';
import { type AwardService, awardServiceStub } from './award';
import { type ContentService, contentServiceStub } from './content';
import { type QuotaService, quotaServiceStub } from './quota';
import { type SrsService, srsServiceStub } from './srs';

export interface Services {
  award: AwardService;
  srs: SrsService;
  quota: QuotaService;
  content: ContentService;
}

/** Builds one service for a request. Factories receive the full registry so services can depend on each other. */
export type ServiceFactory<K extends keyof Services> = (env: Env, services: Services) => Services[K];
export type ServiceFactories = { [K in keyof Services]?: ServiceFactory<K> };

export const STUB_SERVICES: Readonly<Services> = {
  award: awardServiceStub,
  srs: srsServiceStub,
  quota: quotaServiceStub,
  content: contentServiceStub,
};

/**
 * Per-request registry. Each service is built lazily on first access (so a route that only needs
 * `content` never constructs `award`); unregistered services resolve to stubs that throw
 * NotImplementedError. Apps pass real factories to createApp({services}) once slices land (I1).
 */
export function createServices(env: Env, factories: ServiceFactories = {}): Services {
  const built: Partial<Services> = {};
  const registry = {} as Services;
  for (const name of Object.keys(STUB_SERVICES) as (keyof Services)[]) {
    Object.defineProperty(registry, name, {
      enumerable: true,
      get() {
        if (!(name in built)) {
          const factory = factories[name] as ServiceFactory<typeof name> | undefined;
          (built as Record<string, unknown>)[name] = factory ? factory(env, registry) : STUB_SERVICES[name];
        }
        return built[name];
      },
    });
  }
  return registry;
}
