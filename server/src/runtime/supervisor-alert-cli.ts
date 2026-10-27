import { fileURLToPath } from 'node:url';
import { FileSupervisorAlerts, supervisorAlertPath } from './supervisor-alert.js';

try {
  if (process.argv[2] !== '--restart-limit') throw new Error('Unsupported status action');
  new FileSupervisorAlerts(
    supervisorAlertPath(),
    fileURLToPath(new URL('../../../', import.meta.url)),
  ).exhausted();
  console.error('WATCHDOG: restart-limit alert saved for the dashboard.');
} catch {
  console.error('WATCHDOG: could not save restart-limit alert. Check the private status path.');
  process.exitCode = 1;
}
