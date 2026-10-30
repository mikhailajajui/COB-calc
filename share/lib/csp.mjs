import { createHash } from 'node:crypto';

export function cspFor(scriptText) {
  const hash = createHash('sha256').update(scriptText, 'utf8').digest('base64');
  const policy = [
    "default-src 'none'",
    `script-src 'sha256-${hash}'`,
    "style-src 'unsafe-inline'",
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
}
