export const getAverages = (times: number[]) => {
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const sorted = times.slice().sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
    const min = Math.min(...times);
    const max = Math.max(...times);
    return { mean, median, min, max };
}