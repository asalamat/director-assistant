/**
 * Work Stealing Service - Application Layer
 *
 * Handles work stealing to maximize swarm throughput by redistributing
 * work from stale, blocked, or overloaded agents to available ones.
 *
 * @module v3/claims/application/work-stealing-service
 */
import { type IssueId, type Claimant, type AgentType, type StealableInfo, type StealResult, type WorkStealingConfig, type IssueClaimWithStealing, type IIssueClaimRepository, type IWorkStealingEventBus, type WorkStealingEvent, type WorkStealingEventType } from '../domain/types.js';
/**
 * Work Stealing Service Interface
 */
export interface IWorkStealingService {
    /** Mark work as stealable */
    markStealable(issueId: IssueId, info: StealableInfo): Promise<void>;
    /** Steal work from another agent */
    steal(issueId: IssueId, stealer: Claimant): Promise<StealResult>;
    /** Get list of stealable issues */
    getStealable(agentType?: AgentType): Promise<IssueClaimWithStealing[]>;
    /** Contest a steal (original owner wants it back) */
    contestSteal(issueId: IssueId, originalClaimant: Claimant, reason: string): Promise<void>;
    /** Resolve contest (queen/human decides) */
    resolveContest(issueId: IssueId, winner: Claimant, reason: string): Promise<void>;
    /** Auto-detect stealable work based on config thresholds */
    detectStaleWork(config: WorkStealingConfig): Promise<IssueClaimWithStealing[]>;
    /** Auto-mark stealable work based on config thresholds */
    autoMarkStealable(config: WorkStealingConfig): Promise<number>;
}
/**
 * Simple in-memory event bus for work stealing events
 */
export declare class InMemoryWorkStealingEventBus implements IWorkStealingEventBus {
    private handlers;
    private history;
    private maxHistorySize;
    constructor(options?: {
        maxHistorySize?: number;
    });
    emit(event: WorkStealingEvent): Promise<void>;
    subscribe(eventType: WorkStealingEventType, handler: (event: WorkStealingEvent) => void | Promise<void>): () => void;
    subscribeAll(handler: (event: WorkStealingEvent) => void | Promise<void>): () => void;
    getHistory(filter?: {
        types?: WorkStealingEventType[];
        limit?: number;
    }): WorkStealingEvent[];
    private addToHistory;
    private safeExecute;
}
/**
 * Work Stealing Service
 *
 * Implements work stealing algorithms to maximize swarm throughput by
 * redistributing work from stale, blocked, or overloaded agents.
 */
export declare class WorkStealingService implements IWorkStealingService {
    private readonly repository;
    private readonly eventBus;
    private readonly config;
    constructor(repository: IIssueClaimRepository, eventBus: IWorkStealingEventBus, config?: Partial<WorkStealingConfig>);
    /**
     * Mark work as stealable with the given reason
     */
    markStealable(issueId: IssueId, info: StealableInfo): Promise<void>;
    /**
     * Steal work from another agent
     */
    steal(issueId: IssueId, stealer: Claimant): Promise<StealResult>;
    /**
     * Get list of stealable issues, optionally filtered by agent type
     */
    getStealable(agentType?: AgentType): Promise<IssueClaimWithStealing[]>;
    /**
     * Contest a steal (original owner wants the work back)
     */
    contestSteal(issueId: IssueId, originalClaimant: Claimant, reason: string): Promise<void>;
    /**
     * Resolve a contest (queen or human decides the winner)
     */
    resolveContest(issueId: IssueId, winner: Claimant, reason: string): Promise<void>;
    /**
     * Detect stale work based on config thresholds
     */
    detectStaleWork(config: WorkStealingConfig): Promise<IssueClaimWithStealing[]>;
    /**
     * Auto-mark stealable work based on config thresholds
     */
    autoMarkStealable(config: WorkStealingConfig): Promise<number>;
    /**
     * Check if claim is in grace period
     */
    private isInGracePeriod;
    /**
     * Check if claim is in grace period with specific config
     */
    private isInGracePeriodWithConfig;
    /**
     * Check if claim is protected by progress
     */
    private isProtectedByProgress;
    /**
     * Check if claim is protected by progress with specific config
     */
    private isProtectedByProgressWithConfig;
    /**
     * Get agent type from claimant
     */
    private getAgentType;
    /**
     * Check if cross-type stealing is allowed
     */
    private canStealCrossType;
    /**
     * Get allowed stealer types for a claimant
     */
    private getAllowedStealerTypes;
    /**
     * Determine the stale reason for a claim
     */
    private determineStaleReason;
    /**
     * Determine who resolved the contest
     */
    private determineResolver;
    /**
     * Create a steal error result
     */
    private stealError;
    /**
     * Emit IssueMarkedStealable event
     */
    private emitMarkedStealableEvent;
    /**
     * Emit IssueStolen event
     */
    private emitStolenEvent;
    /**
     * Emit StealContested event
     */
    private emitContestEvent;
    /**
     * Emit StealContestResolved event
     */
    private emitContestResolvedEvent;
}
/**
 * Create a new WorkStealingService with default event bus
 */
export declare function createWorkStealingService(repository: IIssueClaimRepository, config?: Partial<WorkStealingConfig>, eventBus?: IWorkStealingEventBus): WorkStealingService;
//# sourceMappingURL=work-stealing-service.d.ts.map