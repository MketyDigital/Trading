import { runV1SimulationAcceptanceCommand } from '../src/testing/v1_simulation_command.js';

const result = await runV1SimulationAcceptanceCommand({ env: process.env, logger: console });
process.exitCode = result.exitCode;
