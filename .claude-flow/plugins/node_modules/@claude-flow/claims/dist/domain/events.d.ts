/**
 * Claim Domain Events (ADR-007)
 *
 * Domain events for the claims system following event sourcing pattern.
 * All state changes emit events for audit trail and projections.
 *
 * @module v3/claims/domain/events
 */
import type { ClaimId, IssueId, Claimant, ClaimStatus } from './types.js';
/**
 * Base interface for all claim domain events
 */
export interface ClaimDomainEvent {
    /** Unique event identifier */
    id: string;
    /** Event type discriminator */
    type: ClaimEventType;
    /** Aggregate ID (claim ID) */
    aggregateId: string;
    /** Aggregate type - always 'claim' for this domain */
    aggregateType: 'claim';
    /** Event version for ordering */
    version: number;
    /** Timestamp when event occurred */
    timestamp: number;
    /** Event source */
    source: string;
    /** Event payload data */
    payload: Record<string, unknown>;
    /** Optional metadata */
    metadata?: Record<string, unknown>;
    /** Optional causation ID (event that caused this event) */
    causationId?: string;
    /** Optional correlation ID (groups related events) */
    correlationId?: string;
}
export type ClaimEventType = 'claim:created' | 'claim:released' | 'claim:expired' | 'claim:status-changed' | 'claim:note-added' | 'handoff:requested' | 'handoff:accepted' | 'handoff:rejected' | 'review:requested' | 'review:completed';
export interface ClaimCreatedEvent extends ClaimDomainEvent {
    type: 'claim:created';
    payload: {
        claimId: ClaimId;
        issueId: IssueId;
        claimant: Claimant;
        claimedAt: number;
        expiresAt?: number;
    };
}
export interface ClaimReleasedEvent extends ClaimDomainEvent {
    type: 'claim:released';
    payload: {
        claimId: ClaimId;
        issueId: IssueId;
        claimant: Claimant;
        releasedAt: number;
        reason?: string;
    };
}
export interface ClaimExpiredEvent extends ClaimDomainEvent {
    type: 'claim:expired';
    payload: {
        claimId: ClaimId;
        issueId: IssueId;
        claimant: Claimant;
        expiredAt: number;
        lastActivityAt: number;
    };
}
export interface ClaimStatusChangedEvent extends ClaimDomainEvent {
    type: 'claim:status-changed';
    payload: {
        claimId: ClaimId;
        issueId: IssueId;
        previousStatus: ClaimStatus;
        newStatus: ClaimStatus;
        changedAt: number;
        note?: string;
    };
}
export interface ClaimNoteAddedEvent extends ClaimDomainEvent {
    type: 'claim:note-added';
    payload: {
        claimId: ClaimId;
        issueId: IssueId;
        note: string;
        addedAt: number;
        addedBy: Claimant;
    };
}
export interface HandoffRequestedEvent extends ClaimDomainEvent {
    type: 'handoff:requested';
    payload: {
        claimId: ClaimId;
        issueId: IssueId;
        handoffId: string;
        from: Claimant;
        to: Claimant;
        reason: string;
        requestedAt: number;
    };
}
export interface HandoffAcceptedEvent extends ClaimDomainEvent {
    type: 'handoff:accepted';
    payload: {
        claimId: ClaimId;
        issueId: IssueId;
        handoffId: string;
        from: Claimant;
        to: Claimant;
        acceptedAt: number;
    };
}
export interface HandoffRejectedEvent extends ClaimDomainEvent {
    type: 'handoff:rejected';
    payload: {
        claimId: ClaimId;
        issueId: IssueId;
        handoffId: string;
        from: Claimant;
        to: Claimant;
        rejectedAt: number;
        reason: string;
    };
}
export interface ReviewRequestedEvent extends ClaimDomainEvent {
    type: 'review:requested';
    payload: {
        claimId: ClaimId;
        issueId: IssueId;
        reviewers: Claimant[];
        requestedAt: number;
        requestedBy: Claimant;
    };
}
export interface ReviewCompletedEvent extends ClaimDomainEvent {
    type: 'review:completed';
    payload: {
        claimId: ClaimId;
        issueId: IssueId;
        reviewer: Claimant;
        approved: boolean;
        completedAt: number;
        comments?: string;
    };
}
export type AllClaimEvents = ClaimCreatedEvent | ClaimReleasedEvent | ClaimExpiredEvent | ClaimStatusChangedEvent | ClaimNoteAddedEvent | HandoffRequestedEvent | HandoffAcceptedEvent | HandoffRejectedEvent | ReviewRequestedEvent | ReviewCompletedEvent;
export declare function createClaimCreatedEvent(claimId: ClaimId, issueId: IssueId, claimant: Claimant, expiresAt?: number): ClaimCreatedEvent;
export declare function createClaimReleasedEvent(claimId: ClaimId, issueId: IssueId, claimant: Claimant, reason?: string): ClaimReleasedEvent;
export declare function createClaimExpiredEvent(claimId: ClaimId, issueId: IssueId, claimant: Claimant, lastActivityAt: number): ClaimExpiredEvent;
export declare function createClaimStatusChangedEvent(claimId: ClaimId, issueId: IssueId, previousStatus: ClaimStatus, newStatus: ClaimStatus, note?: string): ClaimStatusChangedEvent;
export declare function createClaimNoteAddedEvent(claimId: ClaimId, issueId: IssueId, note: string, addedBy: Claimant): ClaimNoteAddedEvent;
export declare function createHandoffRequestedEvent(claimId: ClaimId, issueId: IssueId, handoffId: string, from: Claimant, to: Claimant, reason: string): HandoffRequestedEvent;
export declare function createHandoffAcceptedEvent(claimId: ClaimId, issueId: IssueId, handoffId: string, from: Claimant, to: Claimant): HandoffAcceptedEvent;
export declare function createHandoffRejectedEvent(claimId: ClaimId, issueId: IssueId, handoffId: string, from: Claimant, to: Claimant, reason: string): HandoffRejectedEvent;
export declare function createReviewRequestedEvent(claimId: ClaimId, issueId: IssueId, reviewers: Claimant[], requestedBy: Claimant): ReviewRequestedEvent;
export declare function createReviewCompletedEvent(claimId: ClaimId, issueId: IssueId, reviewer: Claimant, approved: boolean, comments?: string): ReviewCompletedEvent;
import type { AgentId, StealReason, AgentLoadInfo, ClaimMove } from './types.js';
/**
 * Extended event types for ADR-016
 */
export type ExtendedClaimEventType = ClaimEventType | 'steal:issue-marked-stealable' | 'steal:issue-stolen' | 'steal:contest-started' | 'steal:contest-resolved' | 'steal:warning-sent' | 'swarm:rebalanced' | 'agent:overloaded' | 'agent:underloaded' | 'agent:load-changed';
/**
 * Extended base event interface for ADR-016 events
 */
export interface ExtendedClaimDomainEvent {
    /** Unique event identifier */
    id: string;
    /** Event type discriminator */
    type: ExtendedClaimEventType;
    /** Aggregate ID (claim ID) */
    aggregateId: string;
    /** Aggregate type - always 'claim' for this domain */
    aggregateType: 'claim';
    /** Event version for ordering */
    version: number;
    /** Timestamp when event occurred */
    timestamp: number;
    /** Event source */
    source: string;
    /** Event payload data */
    payload: Record<string, unknown>;
    /** Optional metadata */
    metadata?: Record<string, unknown>;
    /** Optional causation ID (event that caused this event) */
    causationId?: string;
    /** Optional correlation ID (groups related events) */
    correlationId?: string;
}
export interface IssueMarkedStealableEvent extends ExtendedClaimDomainEvent {
    type: 'steal:issue-marked-stealable';
    payload: {
        claimId: ClaimId;
        issueId: IssueId;
        originalClaimant: Claimant;
        reason: StealReason;
        gracePeriodMs: number;
        gracePeriodEndsAt: number;
        minPriorityToSteal: string;
        requiresContest: boolean;
    };
}
export interface IssueStolenEvent extends ExtendedClaimDomainEvent {
    type: 'steal:issue-stolen';
    payload: {
        claimId: ClaimId;
        issueId: IssueId;
        originalClaimant: Claimant;
        newClaimant: Claimant;
        reason: StealReason;
        hadContest: boolean;
        contestId?: string;
        progressTransferred: number;
    };
}
export interface StealContestStartedEvent extends ExtendedClaimDomainEvent {
    type: 'steal:contest-started';
    payload: {
        contestId: string;
        claimId: ClaimId;
        issueId: IssueId;
        defender: Claimant;
        challenger: Claimant;
        reason: StealReason;
        endsAt: number;
    };
}
export interface StealContestResolvedExtEvent extends ExtendedClaimDomainEvent {
    type: 'steal:contest-resolved';
    payload: {
        contestId: string;
        claimId: ClaimId;
        issueId: IssueId;
        winner: 'defender' | 'challenger';
        winnerClaimant: Claimant;
        loserClaimant: Claimant;
        resolvedBy: AgentId | 'system';
        reason: string;
    };
}
export interface StealWarningEvent extends ExtendedClaimDomainEvent {
    type: 'steal:warning-sent';
    payload: {
        claimId: ClaimId;
        issueId: IssueId;
        claimant: Claimant;
        reason: StealReason;
        warningNumber: number;
        maxWarnings: number;
        stealableAt: number;
        actionRequired: string;
    };
}
export interface SwarmRebalancedExtEvent extends ExtendedClaimDomainEvent {
    type: 'swarm:rebalanced';
    payload: {
        claimsMoved: number;
        moves: ClaimMove[];
        loadBefore: AgentLoadInfo[];
        loadAfter: AgentLoadInfo[];
        durationMs: number;
        trigger: 'scheduled' | 'overload-detected' | 'underload-detected' | 'manual' | 'agent-added' | 'agent-removed';
        errors: string[];
    };
}
export interface AgentOverloadedExtEvent extends ExtendedClaimDomainEvent {
    type: 'agent:overloaded';
    payload: {
        agentId: AgentId;
        agentName: string;
        currentLoad: number;
        threshold: number;
        activeClaims: number;
        maxClaims: number;
        recommendedAction: 'pause-assignments' | 'rebalance' | 'scale-up' | 'notify-admin';
    };
}
export interface AgentUnderloadedExtEvent extends ExtendedClaimDomainEvent {
    type: 'agent:underloaded';
    payload: {
        agentId: AgentId;
        agentName: string;
        currentLoad: number;
        threshold: number;
        activeClaims: number;
        maxClaims: number;
        availableCapacity: number;
    };
}
export interface AgentLoadChangedEvent extends ExtendedClaimDomainEvent {
    type: 'agent:load-changed';
    payload: {
        agentId: AgentId;
        previousLoad: number;
        currentLoad: number;
        previousClaims: number;
        currentClaims: number;
        changeReason: 'claim-added' | 'claim-completed' | 'claim-released' | 'claim-transferred' | 'capacity-changed';
    };
}
/**
 * All ADR-016 extended events union
 */
export type AllExtendedClaimEvents = AllClaimEvents | IssueMarkedStealableEvent | IssueStolenEvent | StealContestStartedEvent | StealContestResolvedExtEvent | StealWarningEvent | SwarmRebalancedExtEvent | AgentOverloadedExtEvent | AgentUnderloadedExtEvent | AgentLoadChangedEvent;
export declare function createIssueMarkedStealableEvent(claimId: ClaimId, issueId: IssueId, originalClaimant: Claimant, reason: StealReason, gracePeriodMs: number, minPriorityToSteal: string, requiresContest: boolean): IssueMarkedStealableEvent;
export declare function createIssueStolenExtEvent(claimId: ClaimId, issueId: IssueId, originalClaimant: Claimant, newClaimant: Claimant, reason: StealReason, hadContest: boolean, progressTransferred: number, contestId?: string): IssueStolenEvent;
export declare function createSwarmRebalancedExtEvent(claimsMoved: number, moves: ClaimMove[], loadBefore: AgentLoadInfo[], loadAfter: AgentLoadInfo[], durationMs: number, trigger: SwarmRebalancedExtEvent['payload']['trigger'], errors?: string[]): SwarmRebalancedExtEvent;
export declare function createAgentOverloadedExtEvent(agentId: AgentId, agentName: string, currentLoad: number, threshold: number, activeClaims: number, maxClaims: number, recommendedAction: AgentOverloadedExtEvent['payload']['recommendedAction']): AgentOverloadedExtEvent;
export declare function createAgentUnderloadedExtEvent(agentId: AgentId, agentName: string, currentLoad: number, threshold: number, activeClaims: number, maxClaims: number, availableCapacity: number): AgentUnderloadedExtEvent;
//# sourceMappingURL=events.d.ts.map