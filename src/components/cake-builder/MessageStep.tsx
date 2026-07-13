"use client";

import InputField from "@/components/ui/InputField";
import { MAX_MESSAGE_LENGTH } from "@/lib/cake-builder/options";

interface MessageStepProps {
  message: string;
  onChange: (message: string) => void;
}

export default function MessageStep({ message, onChange }: MessageStepProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <InputField
        id="cake-plaque-message"
        name="cake-plaque-message"
        label="Mensaje en la placa"
        placeholder="Ej. Feliz cumpleaños, Nati"
        value={message}
        maxLength={MAX_MESSAGE_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        hint={`${message.length}/${MAX_MESSAGE_LENGTH} caracteres`}
      />
    </div>
  );
}
