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
2. **All runs** (`allRuns` dataset) — metadata of every triggered run: `id`, `status`, `memoryMbs`, `buildNumber`, a normalized `stats` object, `chargedEventCounts` and `usageTotalUsd`. This is the source data for the outliers table.
3. **Run stats** (`runStats` dataset) — aggregated (min / max / mean / median) resource-usage statistics per memory configuration, computed across all runs of that configuration. Memory is normalized to MB and network traffic to kB (the raw Apify API reports both in bytes, which is hard to read). The aggregated fields are:
   - `runTimeSecs` (seconds)
   - `computeUnits`
   - `memAvgMbytes`, `memMaxMbytes` (MB)
   - `cpuAvgUsage`, `cpuMaxUsage` (%)
   - `netRxKbytes`, `netTxKbytes` (kB)
   - `usageTotalUsd` (USD)

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

## How to measure common metrics

### Actor startup times

Actor usually goes through several stages:
- Actor start (API received the call) -> Node.js process start
- Node.js process start -> Node modules loaded
- Node modules loaded -> Actor initialized and input loaded
- Actor initialized and input loaded -> First Crawler request made
- ... (business logic happens here)
- Last Crawler request made -> Actor finished its run (cleanup did run)

### Code to add to your Actor

```ts
import { performance } from 'node:perf_hooks';
import { Actor, log } from 'apify';

// Ideally import this from another file
const getImportPerfTimes = () => {
    const nodeStartToImportMs = performance.now();
    // Not available locally
    let actorStartToNodeStartNegativeMs: number | undefined;

    // We cannot use Actor.getEnv() because that is only available after Actor.init()
    const startedAt = process.env.ACTOR_STARTED_AT;
    if (startedAt) {
        // We do this gymnastics of converting relative date to absolute to relative (to node startup so it is negative)
        const absoluteDateAfterImport = Date.now();
        const dateBeforeNodeStart = absoluteDateAfterImport - nodeStartToImportMs;
        const dateStartedAt = new Date(startedAt).getTime();
        // We output this as negative because it happens before the baseline (nodeStartToImportMs) and the analyzing Actor can better calculate the diffs
        actorStartToNodeStartNegativeMs = dateStartedAt - dateBeforeNodeStart;
    }

    return { nodeStartToImportMs, actorStartToNodeStartNegativeMs };
};

// Call before Actor.init/Actor.main to get accurate startup measurements
const { nodeStartToImportMs, actorStartToNodeStartNegativeMs } = getImportPerfTimes();

await Actor.init();

// Only print the metrics if debug logging is explicitly enabled
const { debugLog } = await Actor.getInputOrThrow();

if (input.debugLog) {
    log.setLevel(log.LEVELS.DEBUG);
}

if (actorStartToNodeStartNegativeMs) {
    log.debug(
        `PERF[start-to-node-process]: Took ${actorStartToNodeStartNegativeMs} ms from Actor start to Node.js start.`,
    );
}
log.debug(`PERF[after-imports]: Took ${nodeStartToImportMs} ms from Node.js start to import packages.`);
log.debug(
    `PERF[after-input]: Took ${performance.now()} ms from Node.js start to process input and initialize Actor.`,
);
```