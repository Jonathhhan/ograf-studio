const MAX_JSON_DEPTH = 100;

function normalizedSource(source: string): string {
  return source.replace(/^\uFEFF/, '');
}

function validateJsonValue(root: unknown): asserts root is object {
  if (!root || typeof root !== 'object')
    throw new Error('JSON resources need an object or array root.');
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('JSON numbers must be finite.');
      if (Number.isInteger(value) && !Number.isSafeInteger(value))
        throw new Error("JSON integers must be within JavaScript's safe integer range.");
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    if (depth >= MAX_JSON_DEPTH) throw new Error(`JSON nesting exceeds ${MAX_JSON_DEPTH} levels.`);
    for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
  }
}

export function parseJsonResource(source: string): object {
  const value: unknown = JSON.parse(normalizedSource(source));
  validateJsonValue(value);
  return value;
}

/** Pretty-print without rewriting number lexemes, duplicate keys, or negative zero. */
export function formatJsonResource(source: string): string {
  const input = normalizedSource(source).trim();
  parseJsonResource(input);
  let output = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  const indentation = () => '  '.repeat(depth);
  const nextNonWhitespace = (start: number) => {
    let index = start;
    while (/\s/.test(input[index] ?? '')) index++;
    return input[index];
  };
  for (let index = 0; index < input.length; index++) {
    const character = input[index]!;
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
    } else if (/\s/.test(character)) continue;
    else if (character === '{' || character === '[') {
      output += character;
      const closing = character === '{' ? '}' : ']';
      if (nextNonWhitespace(index + 1) !== closing) {
        depth++;
        output += '\n' + indentation();
      }
    } else if (character === '}' || character === ']') {
      const opening = character === '}' ? '{' : '[';
      let previous = index - 1;
      while (/\s/.test(input[previous] ?? '')) previous--;
      if (input[previous] !== opening) {
        depth--;
        output += '\n' + indentation();
      }
      output += character;
    } else if (character === ',') output += ',\n' + indentation();
    else if (character === ':') output += ': ';
    else output += character;
  }
  return output;
}

export function parseFrozenJsonResource(source: string): object {
  const root = parseJsonResource(source);
  const objects: object[] = [];
  const pending = [root];
  while (pending.length) {
    const value = pending.pop()!;
    objects.push(value);
    for (const child of Object.values(value))
      if (child && typeof child === 'object') pending.push(child);
  }
  for (let index = objects.length - 1; index >= 0; index--) Object.freeze(objects[index]);
  return root;
}
