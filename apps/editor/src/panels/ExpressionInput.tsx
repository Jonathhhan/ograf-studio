import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';
import {
  indentExpression,
  newlineExpression,
  type ExpressionTextEdit,
} from './expressionTextEditing';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
};

export function ExpressionInput({ value, onValueChange, ...props }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const selection = useRef<ExpressionTextEdit | null>(null);
  const allowTabNavigation = useRef(false);
  useLayoutEffect(() => {
    const edit = selection.current;
    if (!edit) return;
    input.current?.setSelectionRange(edit.start, edit.end);
    selection.current = null;
  }, [value]);
  return (
    <textarea
      {...props}
      ref={input}
      value={value}
      autoCapitalize="off"
      autoCorrect="off"
      aria-description="Tab indents; Shift+Tab outdents. Press Escape then Tab to leave the editor."
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === 'Escape') {
          allowTabNavigation.current = true;
          event.stopPropagation();
          return;
        }
        if (event.key === 'Tab' && allowTabNavigation.current) {
          allowTabNavigation.current = false;
          return;
        }
        allowTabNavigation.current = false;
        if (event.key !== 'Tab' && event.key !== 'Enter') return;
        const field = event.currentTarget;
        const edit =
          event.key === 'Tab'
            ? indentExpression(value, field.selectionStart, field.selectionEnd, event.shiftKey)
            : newlineExpression(value, field.selectionStart, field.selectionEnd);
        event.preventDefault();
        event.stopPropagation();
        if (edit.value === value) return;
        selection.current = edit;
        onValueChange(edit.value);
      }}
    />
  );
}
