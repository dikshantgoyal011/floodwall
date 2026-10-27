import { useId } from "react";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { consoleField, consoleLabel } from "../../styles/classes";

type ConsoleSelectProps<T extends string> = {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
};

/** A labelled dropdown: shadcn's Select, which Base UI makes keyboard- and screen-reader-ready. */
export function ConsoleSelect<T extends string>({ label, value, options, onChange }: ConsoleSelectProps<T>) {
  const id = useId();

  return (
    <div className={consoleField}>
      <Label className={consoleLabel} htmlFor={id}>
        {label}
      </Label>
      <Select value={value} onValueChange={(next) => next !== null && onChange(next)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
