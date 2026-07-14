Actor Performance Evaluator is a simple tool to measure how long it takes to reach certain points in the Actor run.

## Usage
1. You need to add debug logs to your Actor in specific format: `PERF[${name}] ${number}`
2. It is up to you what the number should measure. The standard is to use `performance.now()` from `'perf_hooks'` module which gives you the time in milliseconds since the Node.js process started. This Actor automatically provides the difference from previous measured event.
3. Provide your Actor input, memory setting and how many iterations to run (recommend at least 100 for good averages). The runs should be short ones, this doesn't make much sense for Actors that run for minutes.
4. You get max, min, average and median times for each measured event and differences from previous event.

## Outputs

The Actor produces three datasets and one HTML report.

### Datasets

1. **Results** (default dataset) — per-stage aggregates (min / max / mean / median) of your `PERF[...]` events for each memory configuration, plus the difference from the previous stage. This is the main output described above.
2. **All runs** (`allRuns` dataset) — raw metadata of every triggered run: `id`, `status`, `memoryMbs`, `buildNumber`, the full `stats` object, `chargedEventCounts` and `usageTotalUsd`. This is the source data for the outliers table.
3. **Run stats** (`runStats` dataset) — aggregated (min / max / mean / median) resource-usage statistics per memory configuration, computed across all runs of that configuration. The aggregated fields are:
   - `runTimeSecs`
   - `computeUnits`
   - `memAvgBytes`, `memMaxBytes`
   - `cpuAvgUsage`, `cpuMaxUsage`
   - `netRxBytes`, `netTxBytes`
   - `usageTotalUsd`

   Each item has the shape `{ statName, memoryMbs, min, mean, median, max, count }`.

### HTML report

An interactive HTML report is stored in the default key-value store under the key **`chart`** (see the "Chart" output link). It contains:

- **Source datasets** — links to all three datasets above so the source data behind every chart is clear.
- **Stage Charts** — the original per-stage latency charts (absolute and from-previous-step views).
- **Run Stats** — a bar chart per aggregated resource stat, comparing min / mean / median / max across memory configurations.
- **Outliers** — a table of individual runs whose resource usage deviates significantly (|z-score| &gt; 2) from the other runs in the same memory configuration, sorted by deviation. Each row links to the run in Apify Console.

## Output example

### Results dataset (per-stage aggregates)

```json
[
  {
    "eventName": "after-imports",
    "memoryMbs": "4096",
    "median": 598.87924,
    "mean": 633.0843160899999,
    "min": 481.925876,
    "max": 1038.968083
  },
  {
    "eventName": "after-input",
    "memoryMbs": "4096",
    "median": 784.8505485000001,
    "mean": 835.2474801699999,
    "min": 615.089415,
    "max": 1419.346805,
    "fromPreviousMean": 202.16316407999992,
    "fromPreviousMedian": 185.375318,
    "fromPreviousMin": 116.97888800000004,
    "fromPreviousMax": 481.7879959999999
  },
  {
    "eventName": "before-crawler-run",
    "memoryMbs": "4096",
    "median": 940.281442,
    "mean": 993.0418763499997,
    "min": 719.599819,
    "max": 1610.416095,
    "fromPreviousMean": 157.79439617999998,
    "fromPreviousMedian": 151.0749715,
    "fromPreviousMin": 104.510404,
    "fromPreviousMax": 369.22714999999994
  }
]
```

### Run stats dataset (resource-usage aggregates)

```json
[
  {
    "statName": "runTimeSecs",
    "memoryMbs": "4096",
    "min": 11.523,
    "max": 38.104,
    "mean": 17.842,
    "median": 16.5,
    "count": 100
  },
  {
    "statName": "usageTotalUsd",
    "memoryMbs": "4096",
    "min": 0.0011,
    "max": 0.0043,
    "mean": 0.0019,
    "median": 0.0018,
    "count": 100
  }
]
```