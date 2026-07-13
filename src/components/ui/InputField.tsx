import { forwardRef, type InputHTMLAttributes } from "react";

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

const FIELD_CLASSES =
  "w-full rounded-xl border bg-cream-light px-4 py-2.5 text-sm text-cocoa placeholder:text-text-secondary/60 outline-none transition-colors focus:border-terracotta focus:ring-2 focus:ring-terracotta/20 disabled:cursor-not-allowed disabled:opacity-60";

const InputField = forwardRef<HTMLInputElement, InputFieldProps>(
  ({ label, error, hint, id, required, className, name, ...rest }, ref) => {
    const inputId = id ?? name;
    const errorId = error ? `${inputId}-error` : undefined;
    const hintId = hint ? `${inputId}-hint` : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium text-cocoa">
          {label}
          {required && (
            <span aria-hidden className="text-terracotta">
              {" "}
              *
            </span>
          )}
        </label>
        <input
          ref={ref}
          id={inputId}
          name={name}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          className={`${FIELD_CLASSES} ${error ? "border-red-400" : "border-border-soft"} ${className ?? ""}`}
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

InputField.displayName = "InputField";
export default InputField;
