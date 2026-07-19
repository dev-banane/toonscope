import fs from 'node:fs';

export function writeFileSyncRetrying(
  filePath: string,
  data: string,
  attempts = 5
): void {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      fs.writeFileSync(filePath, data, 'utf8');
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      const until = Date.now() + attempt * 10;
      while (Date.now() < until) {
        // brief synchronous backoff
      }
    }
  }
}
