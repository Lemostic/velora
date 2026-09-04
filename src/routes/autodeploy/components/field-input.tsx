// Inspector 字段组件 —— 根据 FieldDef.kind 渲染对应的输入控件
//
// 视觉：Element Plus 风格
//   - label 在输入框上方，required 字段加红色星号
//   - 控件：input / select / checkbox
//   - 高度统一 32px，圆角 4px

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { FieldDef } from "../types";
import { cn } from "@/lib/utils";

interface Props {
  field: FieldDef;
  value: string;
  onChange: (value: string) => void;
}

export function FieldInput({ field, value, onChange }: Props) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-[12px] text-[#606266]">
        {field.label}
        {field.required && <span className="text-[#f56c6c]">*</span>}
      </span>
      {field.kind === "checkbox" ? (
        <CheckboxField
          checked={value === "true" || value === "1"}
          onChange={(v) => onChange(v ? "true" : "false")}
        />
      ) : field.kind === "select" ? (
        <SelectField
          field={field}
          value={value || field.default || ""}
          onChange={onChange}
        />
      ) : field.kind === "path" ? (
        <PathField
          field={field}
          value={value || ""}
          onChange={onChange}
        />
      ) : field.kind === "number" ? (
        <input
          type="number"
          value={value || ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      ) : (
        <input
          type="text"
          value={value || ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      )}
    </label>
  );
}

const inputCls = cn(
  "h-8 w-full rounded border border-[var(--border)] bg-white px-2 text-[13px] text-[#303133] outline-none transition-colors",
  "placeholder:text-[#c0c4cc]",
  "focus:border-[var(--primary)] focus:shadow-[0_0_0_2px_var(--primary-light-9)]",
);

function CheckboxField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      className={cn(
        "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded border transition-colors",
        checked
          ? "border-[var(--primary)] bg-[var(--primary)] text-white"
          : "border-[var(--border)] bg-white text-transparent hover:border-[var(--primary-light-3)]",
      )}
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor">
        <path d="M6 11.2 2.8 8l-1.4 1.4L6 14l8-8-1.4-1.4z" />
      </svg>
    </span>
  );
}

function SelectField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputCls, "cursor-pointer appearance-none pr-7")}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' stroke='%23909399' fill='none' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 8px center",
      }}
    >
      {(field.options ?? []).map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function PathField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1">
      <input
        type="text"
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls, "flex-1 font-mono text-[12px]")}
      />
      <button
        type="button"
        onClick={async () => {
          // field label 暗示是 file 还是 directory
          const isDir = /目录|directory|dir|folder/i.test(field.label);
          try {
            const picked = await openDialog({
              multiple: false,
              directory: isDir,
            });
            if (typeof picked === "string") onChange(picked);
          } catch {
            // 用户取消 / 无对话框时静默
          }
        }}
        className="h-8 shrink-0 rounded border border-[var(--border)] bg-white px-2 text-[12px] text-[#606266] transition-colors hover:border-[var(--primary-light-3)] hover:text-[var(--primary)]"
        title={/目录/i.test(field.label) ? "选择目录" : "选择文件"}
      >
        浏览
      </button>
    </div>
  );
}
