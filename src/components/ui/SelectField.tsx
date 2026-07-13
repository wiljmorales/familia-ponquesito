import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  placeholder?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  ({ label, error, placeholder, options, id, required, className, name, ...rest }, ref) => {
    const selectId = id ?? name;
    const errorId = error ? `${selectId}-error` : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={selectId} className="text-sm font-medium text-cocoa">
          {label}
          {required && (
            <span aria-hidden className="text-terracotta">
              {" "}
              *
            </span>
          )}
        </label>
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            name={name}
            required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={errorId}
            defaultValue=""
            className={`w-full appearance-none rounded-xl border bg-cream-light px-4 py-2.5 pr-10 text-sm text-cocoa outline-none transition-colors focus:border-terracotta focus:ring-2 focus:ring-terracotta/20 disabled:cursor-not-allowed disabled:opacity-60 ${
              error ? "border-red-400" : "border-border-soft"
            } ${className ?? ""}`}
            {...rest}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
          />
        </div>
        {error && (
          <p id={errorId} role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  },
);

SelectField.displayName = "SelectField";
export default SelectField;
