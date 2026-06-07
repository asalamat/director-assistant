/**
 * @claude-flow/performance - Flash Attention Benchmarks
 *
 * Comprehensive benchmark suite for Flash Attention performance validation.
 * Validates 2.49x-7.47x speedup targets and memory efficiency improvements.
 */
import { FlashAttentionOptimizer, createFlashAttentionOptimizer } from './attention-integration.js';
export interface ComparisonBenchmark {
    name: string;
    dimension: number;
    numKeys: number;
    iterations: number;
    results: {
        flash: {
            averageTimeMs: number;
            opsPerSecond: number;
            memoryUsageBytes?: number;
        };
        baseline: {
            averageTimeMs: number;
            opsPerSecond: number;
            memoryUsageBytes?: number;
        };
        speedup: number;
        memoryReduction?: number;
    };
    meetsTarget: boolean;
    timestamp: Date;
}
export interface SuiteResult {
    suiteName: string;
    benchmarks: ComparisonBenchmark[];
    summary: {
        averageSpeedup: number;
        minSpeedup: number;
        maxSpeedup: number;
        targetsMet: number;
        totalBenchmarks: number;
        successRate: number;
    };
    timestamp: Date;
}
export interface MemoryProfile {
    dimension: number;
    numKeys: number;
    flashMemoryBytes: number;
    baselineMemoryBytes: number;
    reduction: number;
    reductionBytes: number;
}
export declare class AttentionBenchmarkRunner {
    /**
     * Run comprehensive benchmark suite across multiple dimensions
     */
    runComprehensiveSuite(): SuiteResult;
    /**
     * Run benchmark comparing Flash Attention vs baseline
     */
    runComparison(dimension: number, numKeys?: number, iterations?: number): ComparisonBenchmark;
    /**
     * Run memory profiling benchmark
     */
    runMemoryProfile(dimensions?: number[]): MemoryProfile[];
    /**
     * Run stress test with increasing load
     */
    runStressTest(): ComparisonBenchmark[];
    /**
     * Validate V3 performance targets (2.49x-7.47x speedup)
     */
    validateV3Targets(): {
        meetsMinimum: boolean;
        meetsMaximum: boolean;
        actualSpeedup: number;
        target: {
            min: number;
            max: number;
        };
    };
    /**
     * Profile memory usage for a specific configuration
     */
    private profileMemory;
    /**
     * Calculate memory reduction percentage
     */
    private calculateMemoryReduction;
    /**
     * Get current memory usage
     */
    private getMemoryUsage;
    /**
     * Create suite result with summary statistics
     */
    private createSuiteResult;
}
/**
 * Format benchmark results as human-readable table
 */
export declare function formatBenchmarkTable(benchmark: ComparisonBenchmark): string;
/**
 * Format suite results as summary report
 */
export declare function formatSuiteReport(suite: SuiteResult): string;
/**
 * Format memory profile as table
 */
export declare function formatMemoryProfile(profiles: MemoryProfile[]): string;
/**
 * Quick performance validation
 */
export declare function quickValidation(): boolean;
/**
 * Run and display comprehensive benchmark suite
 */
export declare function runAndDisplaySuite(): SuiteResult;
/**
 * Run and display memory profile
 */
export declare function runAndDisplayMemoryProfile(): MemoryProfile[];
export { FlashAttentionOptimizer, createFlashAttentionOptimizer };
//# sourceMappingURL=attention-benchmarks.d.ts.map