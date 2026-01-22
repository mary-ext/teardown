import { createEventEmitter } from '../lib/emitter';

import type { ProgressMessage } from './worker-protocol';

/**
 * emitted during package initialization and bundling.
 */
export const progress = createEventEmitter<[ProgressMessage]>();
