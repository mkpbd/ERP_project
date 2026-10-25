import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  readonly requestId: string;
  readonly correlationId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/** Per-request metadata available anywhere in the call chain without parameter threading. */
export const RequestContext = {
  run<T>(store: RequestContextStore, work: () => T): T {
    return storage.run(store, work);
  },
  current(): RequestContextStore | undefined {
    return storage.getStore();
  },
};
