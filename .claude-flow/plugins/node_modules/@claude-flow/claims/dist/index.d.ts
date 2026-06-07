/**
 * @claude-flow/claims (ADR-016)
 *
 * Issue claiming and handoff management for human and agent collaboration.
 *
 * Features:
 * - Issue claiming and releasing
 * - Human-to-agent and agent-to-agent handoffs
 * - Status tracking and updates (active, paused, handoff-pending, review-requested, blocked, stealable, completed)
 * - Auto-management (expiration, auto-assignment)
 * - Work stealing with contest windows
 * - Load balancing and swarm rebalancing
 * - Full event sourcing (ADR-007)
 *
 * MCP Tools (17 total):
 * - Core Claiming (7): claim, release, handoff, status_update, list_available, list_mine, board
 * - Work Stealing (4): mark_stealable, steal, get_stealable, contest_steal
 * - Load Balancing (3): agent_load_info, swarm_rebalance, swarm_load_overview
 * - Additional (3): claim_history, claim_metrics, claim_config
 *
 * ADR-016 Types:
 * - ClaimStatus: active | paused | handoff-pending | review-requested | blocked | stealable | completed
 * - ClaimantType: human | agent
 * - StealReason: timeout | overloaded | blocked | voluntary | rebalancing | abandoned | priority-change
 * - HandoffReason: capacity | expertise | shift-change | escalation | voluntary | rebalancing
 *
 * @module v3/claims
 */
export * from './domain/index.js';
export * from './application/index.js';
export * from './infrastructure/index.js';
export { claimsTools, coreClaimingTools, workStealingTools, loadBalancingTools, additionalClaimsTools, issueClaimTool, issueReleaseTool, issueHandoffTool, issueStatusUpdateTool, issueListAvailableTool, issueListMineTool, issueBoardTool, issueMarkStealableTool, issueStealTool, issueGetStealableTool, issueContestStealTool, agentLoadInfoTool, swarmRebalanceTool, swarmLoadOverviewTool, claimHistoryTool, claimMetricsTool, claimConfigTool, registerClaimsTools, getClaimsToolsByCategory, getClaimsToolByName, } from './api/mcp-tools.js';
//# sourceMappingURL=index.d.ts.map