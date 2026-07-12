import { forwardRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { Upload } from "lucide-react";

interface FileFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string;
  hint?: string;
}

const FileField = forwardRef<HTMLInputElement, FileFieldProps>(
  ({ label, error, hint, id, name, onChange, ...rest }, ref) => {
    const [fileName, setFileName] = useState<string | null>(null);
    const fieldId = id ?? name;
    const errorId = error ? `${fieldId}-error` : undefined;
    const hintId = hint ? `${fieldId}-hint` : undefined;

    function handleChange(event: ChangeEvent<HTMLInputElement>) {
      setFileName(event.target.files?.[0]?.name ?? null);
      onChange?.(event);
    }

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium text-cocoa">
          {label}
        </label>
        <div className="flex flex-wrap items-center gap-3 has-[input:focus-visible]:outline has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-terracotta-dark">
          <label
            htmlFor={fieldId}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border-soft bg-cream-light px-4 py-2 text-sm font-medium text-cocoa transition-colors hover:border-terracotta"
          >
            <Upload aria-hidden className="size-4" />
            Subir imagen
          </label>
          <span className="truncate text-sm text-text-secondary">
            {fileName ?? "Ningún archivo seleccionado"}
          </span>
          <input
            ref={ref}
            id={fieldId}
            name={name}
            type="file"
            onChange={handleChange}
            aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
            aria-invalid={Boolean(error)}
            className="sr-only"
            {...rest}
          />
        </div>
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

FileField.displayName = "FileField";
export default FileField;
