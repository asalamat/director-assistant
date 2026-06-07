/**
 * @claude-flow/claims - Event Store Implementation
 * Event sourcing storage for claims (ADR-007, ADR-016)
 *
 * @module v3/claims/infrastructure/event-store
 */
import { ClaimId, IssueId } from '../domain/types.js';
import { ClaimDomainEvent, AllExtendedClaimEvents, ClaimEventType, ExtendedClaimEventType } from '../domain/events.js';
import { IClaimEventStore } from '../domain/repositories.js';
export interface EventFilter {
    aggregateId?: string;
    eventTypes?: (ClaimEventType | ExtendedClaimEventType)[];
    fromTimestamp?: number;
    toTimestamp?: number;
    fromVersion?: number;
    toVersion?: number;
    limit?: number;
    offset?: number;
}
export interface EventSubscription {
    id: string;
    eventTypes: (ClaimEventType | ExtendedClaimEventType)[];
    handler: (event: AllExtendedClaimEvents) => void | Promise<void>;
}
/**
 * In-memory implementation of the event store
 * Suitable for development and testing
 */
export declare class InMemoryClaimEventStore implements IClaimEventStore {
    private events;
    private aggregateVersions;
    private subscriptions;
    private nextSubscriptionId;
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    append(event: ClaimDomainEvent): Promise<void>;
    appendBatch(events: ClaimDomainEvent[]): Promise<void>;
    getEvents(claimId: ClaimId, fromVersion?: number): Promise<ClaimDomainEvent[]>;
    getEventsByType(type: string): Promise<ClaimDomainEvent[]>;
    getEventsByIssueId(issueId: IssueId): Promise<ClaimDomainEvent[]>;
    query(filter: EventFilter): Promise<AllExtendedClaimEvents[]>;
    subscribe(eventTypes: (ClaimEventType | ExtendedClaimEventType)[], handler: (event: AllExtendedClaimEvents) => void | Promise<void>): () => void;
    subscribeAll(handler: (event: AllExtendedClaimEvents) => void | Promise<void>): () => void;
    private notifySubscribers;
    getAggregateVersion(aggregateId: string): Promise<number>;
    getAggregateState<T>(aggregateId: string, reducer: (state: T, event: AllExtendedClaimEvents) => T, initialState: T): Promise<T>;
    private snapshots;
    saveSnapshot<T>(aggregateId: string, state: T, version: number): Promise<void>;
    getSnapshot<T>(aggregateId: string): Promise<{
        state: T;
        version: number;
    } | null>;
    getStateFromSnapshot<T>(aggregateId: string, reducer: (state: T, event: AllExtendedClaimEvents) => T, initialState: T): Promise<T>;
    getEventCount(): Promise<number>;
    getEventCountByType(): Promise<Record<string, number>>;
    getAggregateCount(): Promise<number>;
}
/**
 * Create a new event store
 */
export declare function createClaimEventStore(): InMemoryClaimEventStore;
//# sourceMappingURL=event-store.d.ts.map