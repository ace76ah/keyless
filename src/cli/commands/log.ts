import { readAuditEvents, verifyAuditLog } from '../../daemon/audit.ts';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultAuditPath(): string {
  return join(homedir(), '.keyless', 'audit.log');
}

export async function runLogCommand(path = defaultAuditPath()): Promise<void> {
  const head = await verifyAuditLog(path);
  const events = await readAuditEvents(path);
  process.stdout.write(`Audit integrity: verified (${head.sequence} events)\n`);
  if (events.length === 0) {
    process.stdout.write('No audit events.\n');
    return;
  }
  const columns = [
    ['TIME', (event: typeof events[number]) => event.timestamp],
    ['PROJECT', (event: typeof events[number]) => event.projectId],
    ['ALIAS', (event: typeof events[number]) => event.alias],
    ['METHOD', (event: typeof events[number]) => event.method],
    ['HOST', (event: typeof events[number]) => event.host],
    ['PATH', (event: typeof events[number]) => event.path],
    ['STATUS', (event: typeof events[number]) => String(event.status)],
    ['MS', (event: typeof events[number]) => String(event.durationMs)],
  ] as const;
  const widths = columns.map(([title, get]) => Math.min(48, Math.max(title.length, ...events.map((event) => get(event).length))));
  process.stdout.write(columns.map(([title], index) => title.padEnd(widths[index])).join('  ') + '\n');
  process.stdout.write(widths.map((width) => '-'.repeat(width)).join('  ') + '\n');
  for (const event of events) {
    process.stdout.write(columns.map(([, get], index) => {
      const value = get(event);
      return (value.length > widths[index] ? `${value.slice(0, widths[index] - 1)}…` : value).padEnd(widths[index]);
    }).join('  ') + '\n');
  }
}
