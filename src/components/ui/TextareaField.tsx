import { forwardRef, type TextareaHTMLAttributes } from "react";

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  ({ label, error, hint, id, required, className, name, rows = 4, ...rest }, ref) => {
    const textareaId = id ?? name;
    const errorId = error ? `${textareaId}-error` : undefined;
    const hintId = hint ? `${textareaId}-hint` : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={textareaId} className="text-sm font-medium text-cocoa">
          {label}
          {required && (
            <span aria-hidden className="text-terracotta">
              {" "}
              *
            </span>
          )}
        </label>
        <textarea
          ref={ref}
          id={textareaId}
          name={name}
          rows={rows}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          className={`w-full resize-y rounded-xl border bg-cream-light px-4 py-2.5 text-sm text-cocoa placeholder:text-text-secondary/60 outline-none transition-colors focus:border-terracotta focus:ring-2 focus:ring-terracotta/20 disabled:cursor-not-allowed disabled:opacity-60 ${
            error ? "border-red-400" : "border-border-soft"
          } ${className ?? ""}`}
          {...rest}
        />
        {hint && !error && (
          <p id={hintId} className="text-xs text-text-secondary">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  },
);

TextareaField.displayName = "TextareaField";
export default TextareaField;
