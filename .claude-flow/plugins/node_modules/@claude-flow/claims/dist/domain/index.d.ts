/**
 * Claims Domain Layer (ADR-016)
 *
 * Exports all domain types, events, rules, and repository interfaces
 * for the issue claiming system.
 *
 * @module v3/claims/domain
 */
export type { ClaimId, IssueId, ClaimantType, ClaimStatus, IssueLabel, IssuePriority, IssueComplexity, Duration, Claimant, Issue, IssueClaim, HandoffRecord, IssueWithClaim, ClaimResult, IssueFilters, ClaimErrorCode, ClaimError, AgentType, StealableReason, StealableInfo, StealErrorCode, StealResult, ContestInfo, ContestResolution, WorkStealingConfig, IssueClaimWithStealing, WorkStealingEventType, WorkStealingEvent, ExtendedClaimStatus, AgentId, UserId, BlockedReason, BlockedInfo, StealReason, ExtendedStealableInfo, HandoffReason, ExtendedHandoffInfo, ClaimantWorkload, ExtendedClaimant, AgentLoadInfo, ClaimMove, RebalanceError, ExtendedRebalanceResult, RebalanceStrategy, LoadBalancingConfig, ExtendedIssueClaim, ClaimNote, StatusChange, ClaimQueryOptions, ClaimStatistics, IIssueClaimRepository, IWorkStealingEventBus, } from './types.js';
export { durationToMs, generateClaimId, isActiveClaimStatus, getValidStatusTransitions, ClaimOperationError, DEFAULT_WORK_STEALING_CONFIG, DEFAULT_LOAD_BALANCING_CONFIG, } from './types.js';
export type { ClaimDomainEvent, ClaimEventType, AllClaimEvents, ClaimCreatedEvent, ClaimReleasedEvent, ClaimExpiredEvent, ClaimStatusChangedEvent, ClaimNoteAddedEvent, HandoffRequestedEvent, HandoffAcceptedEvent, HandoffRejectedEvent, ReviewRequestedEvent, ReviewCompletedEvent, ExtendedClaimEventType, ExtendedClaimDomainEvent, IssueMarkedStealableEvent, IssueStolenEvent, StealContestStartedEvent, StealContestResolvedExtEvent, StealWarningEvent, SwarmRebalancedExtEvent, AgentOverloadedExtEvent, AgentUnderloadedExtEvent, AgentLoadChangedEvent, AllExtendedClaimEvents, } from './events.js';
export { createClaimCreatedEvent, createClaimReleasedEvent, createClaimExpiredEvent, createClaimStatusChangedEvent, createClaimNoteAddedEvent, createHandoffRequestedEvent, createHandoffAcceptedEvent, createHandoffRejectedEvent, createReviewRequestedEvent, createReviewCompletedEvent, createIssueMarkedStealableEvent, createIssueStolenExtEvent, createSwarmRebalancedExtEvent, createAgentOverloadedExtEvent, createAgentUnderloadedExtEvent, } from './events.js';
export type { IClaimRepository, IIssueRepository, IClaimantRepository, IClaimEventStore, } from './repositories.js';
export type { RuleResult, } from './rules.js';
export { ruleSuccess, ruleFailure, canClaimIssue, isIssueClaimed, isActiveClaim, getOriginalStatusTransitions, getExtendedStatusTransitions, canTransitionStatus, canMarkAsStealable, canStealClaim, requiresStealContest, canInitiateHandoff, canAcceptHandoff, canRejectHandoff, isAgentOverloaded, isAgentUnderloaded, needsRebalancing, canMoveClaim, isValidPriority, isValidStatus, isValidExtendedStatus, isValidRepository, } from './rules.js';
//# sourceMappingURL=index.d.ts.map