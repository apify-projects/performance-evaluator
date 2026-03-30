Actor Performance Evaluator is a simple tool to measure how long it takes to reach certain points in the Actor run.

## Usage
1. You need to add debug logs to your Actor in specific format: `PERF[${name}] ${number}`
2. It is up to you what the number should measure. The standard is to use `performance.now()` from `'perf_hooks'` module which gives you the time in milliseconds since the Node.js process started. This Actor automatically provides the difference from previous measured event.
3. Provide your Actor input, memory setting and how many iterations to run (recommend at least 100 for good averages). The runs should be short ones, this doesn't make much sense for Actors that run for minutes.
4. You get max, min, average and median times for each measured event and differences from previous event.

## Output example

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