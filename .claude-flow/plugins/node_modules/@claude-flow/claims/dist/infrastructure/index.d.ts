/**
 * @claude-flow/claims - Infrastructure Layer
 *
 * Exports persistence implementations for the claims module.
 *
 * @module v3/claims/infrastructure
 */
export { InMemoryClaimRepository, createClaimRepository, } from './claim-repository.js';
export { InMemoryClaimEventStore, createClaimEventStore, type EventFilter, type EventSubscription, } from './event-store.js';
//# sourceMappingURL=index.d.ts.map