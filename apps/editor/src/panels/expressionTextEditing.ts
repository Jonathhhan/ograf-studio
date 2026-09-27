export interface ExpressionTextEdit {
  value: string;
  start: number;
  end: number;
}

/** Text-only edits; never interpret or execute a partially authored expression. */
export function indentExpression(
  value: string,
  start: number,
  end: number,
  outdent = false,
): ExpressionTextEdit {
  if (!outdent && start === end)
    return {
      value: value.slice(0, start) + '  ' + value.slice(end),
      start: start + 2,
      end: start + 2,
    };
  const first = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const next = value.indexOf('\n', last);
  const stop = next < 0 ? value.length : next;
  const lines = value.slice(first, stop).split('\n');
  const deltas = lines.map((line) =>
    outdent ? -(line.match(/^(?: {1,2}|\t)/)?.[0].length ?? 0) : 2,
  );
  const replacement = lines
    .map((line, index) => (outdent ? line.slice(-deltas[index]!) : '  ' + line))
    .join('\n');
  const adjustedStart = outdent ? Math.max(first, start + deltas[0]!) : start + 2;
  return {
    value: value.slice(0, first) + replacement + value.slice(stop),
    start: adjustedStart,
    end: Math.max(adjustedStart, end + deltas.reduce((sum, delta) => sum + delta, 0)),
  };
}

export function newlineExpression(value: string, start: number, end: number): ExpressionTextEdit {
  const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  const before = value.slice(lineStart, start);
  const indent = before.match(/^[ \t]*/)?.[0] ?? '';
  const opensBlock = /[{[(]\s*$/.test(before);
  const padding = indent + (opensBlock ? '  ' : '');
  const closesBlock = opensBlock && /^[}\])]/.test(value.slice(end));
  const inserted = '\n' + padding + (closesBlock ? '\n' + indent : '');
  const cursor = start + 1 + padding.length;
  return { value: value.slice(0, start) + inserted + value.slice(end), start: cursor, end: cursor };
}
