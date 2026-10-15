// -----------------------------------------------------------------------------
// Entry point of the Tractive integration for Gladys Assistant: SDK wiring
// only. Everything else lives in src/ (see src/app.js).
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
//     (read by the SDK);
//   - LOG_LEVEL (optional): debug shows the per-update lines.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';

const gladys = new GladysIntegration();
const app = registerHandlers(gladys);

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal}, stopping`);
  await app.stop();
});

logger.info('Starting the Tractive integration');
gladys.connect().catch((err) => {
  logger.error('Initial connection to Gladys failed', err);
  process.exit(1);
});
