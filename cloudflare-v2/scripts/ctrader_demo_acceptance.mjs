import { runCTraderDemoCommand } from '../src/testing/ctrader_demo_runner.js';

const result = await runCTraderDemoCommand({ env: process.env, logger: console });
process.exitCode = result.exitCode;
