Actor Performance Evaluator is a simple tool to measure how long it takes to reach certain points in the Actor run.

## Usage
1. You need to add debug logs to your Actor in specific format: `PERF[${name}] ${number}`
2. It is up to you what the number should measure. The standard is to use `performance.now()` from `'perf_hooks'` module which gives you the time in milliseconds since the Node.js process started. This Actor automatically provides the difference from previous measured event.
3. Provide your Actor input, memory setting and how many iterations to run (recommend at least 100 for good averages). The runs should be short ones, this doesn't make much sense for Actors that run for minutes.
4. You get max, min, average and median times for each measured event and differences from previous event.