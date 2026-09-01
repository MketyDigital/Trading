import { runMT5DemoCommand } from '../src/testing/mt5_demo_runner.js';

const result = await runMT5DemoCommand({ env: process.env, logger: console });
process.exitCode = result.exitCode;
